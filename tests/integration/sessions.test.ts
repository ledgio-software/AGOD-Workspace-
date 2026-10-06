import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { communitySessionAttendees, communitySessions, memberProfiles, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Member, acceptConduct, ensureProfile, listReports, resolveReport } from "@/modules/community";
import {
  addRecording,
  callProvider,
  cancelSession,
  createSession,
  getSession,
  hostingStatus,
  joinSession,
  leaveSession,
  listSessions,
  reportSession,
  sendSessionReminders,
  sessionsTakenPart,
  unhideSession,
  updateSession,
} from "@/modules/community/sessions";
import { createUser, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 27: teaching sessions: hosting, joining, the private call link, emails, reminders.

let outbox = "";
beforeEach(() => {
  outbox = mkdtempSync(path.join(tmpdir(), "agod-outbox-"));
  vi.stubEnv("EMAIL_OUTBOX_DIR", outbox);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());

type Mail = { to: string; subject: string; text: string; attachments: { filename: string; bytes: number }[]; id: string };
const mails = (): Mail[] =>
  readdirSync(outbox)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ ...JSON.parse(readFileSync(path.join(outbox, f), "utf8")), id: f.replace(/\.json$/, "") }));
const mailTo = (to: string, subject: RegExp) => mails().filter((m) => m.to === to && subject.test(m.subject));

async function member(o: { conduct?: boolean; reviewer?: boolean } = {}): Promise<Member> {
  const id = randomUUID();
  const m = { id, name: `Member ${id.slice(0, 4)}`, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  await ensureProfile(m);
  if (o.conduct !== false) await acceptConduct(m);
  if (o.reviewer) await db.update(memberProfiles).set({ reviewer: true }).where(eq(memberProfiles.userId, id));
  return m;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const input = (extra: Record<string, unknown> = {}) => ({
  title: "Build your first app with AI",
  description: "We build a small MoMo tracker live with Lovable. Bring a laptop.",
  level: "BEGINNER" as const,
  topics: "Lovable, Prompting",
  date: addDays(todayInOperatingZone(), 3),
  time: "18:00",
  durationMinutes: 90,
  callUrl: "meet.google.com/abc-defg-hij",
  capacity: "",
  ...extra,
});
/** Moves a session in time (tests only: the app refuses past times). */
const shift = (id: string, startsAt: Date, minutes = 60) =>
  db.update(communitySessions).set({ startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) }).where(eq(communitySessions.id, id));

describe("hosting", () => {
  it("is for Reviewers and organizers who agreed to the code of conduct", async () => {
    expect((await hostingStatus(await member({ conduct: false, reviewer: true }))).reason).toMatch(/code of conduct/);
    const plain = await member();
    expect((await hostingStatus(plain)).reason).toMatch(/Reviewers/);
    await expect(createSession(plain, input())).rejects.toThrow(/Reviewers/);
    const organizer = await member();
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", organizer.email);
    expect((await hostingStatus(organizer)).allowed).toBe(true);

    const host = await member({ reviewer: true });
    const s = await createSession(host, input());
    expect(s).toMatchObject({ callUrl: "https://meet.google.com/abc-defg-hij", topics: ["Lovable", "Prompting"], capacity: null, level: "BEGINNER" });
    expect(s.startsAt.toISOString()).toBe(`${addDays(todayInOperatingZone(), 3)}T18:00:00.000Z`);
    expect(s.endsAt.getTime() - s.startsAt.getTime()).toBe(90 * 60_000);
    expect(callProvider(s.callUrl)).toBe("Google Meet");
    expect(callProvider("https://us02web.zoom.us/j/123")).toBe("Zoom");
    expect(callProvider("https://discord.gg/abc")).toBe("Discord");
  });

  it("checks times, the call link, seats, and five upcoming sessions per host", async () => {
    const host = await member({ reviewer: true });
    await expect(createSession(host, input({ date: addDays(todayInOperatingZone(), -1) }))).rejects.toThrow(/10 minutes from now/);
    await expect(createSession(host, input({ callUrl: "" }))).rejects.toThrow(/call link/);
    await expect(createSession(host, input({ capacity: "1" }))).rejects.toThrow(/Seats/);
    await expect(createSession(host, input({ durationMinutes: 400 }))).rejects.toThrow(/6 hours/);
    for (let i = 0; i < 5; i++) await createSession(host, input({ title: `Session ${i}` }));
    await expect(createSession(host, input())).rejects.toThrow(/5 upcoming sessions/);
  });
});

describe("joining", () => {
  it("takes a seat, emails a confirmation with a calendar file, and keeps the call link private", async () => {
    const host = await member({ reviewer: true });
    const s = await createSession(host, input({ capacity: "2" }));
    const visitor = null;
    const ama = await member();
    const kofi = await member();
    const late = await member();

    expect((await getSession(s.id, visitor))!.session.callUrl).toBeNull();
    expect((await getSession(s.id, ama))!.session.callUrl).toBeNull();
    expect((await getSession(s.id, host))!.session.callUrl).toBe(s.callUrl);

    await expect(joinSession(host, s.id)).rejects.toThrow(/hosting/);
    await expect(joinSession(await member({ conduct: false }), s.id)).rejects.toThrow(/code of conduct/);
    await joinSession(ama, s.id);
    await expect(joinSession(ama, s.id)).rejects.toThrow(/already joined/);
    await joinSession(kofi, s.id);
    await expect(joinSession(late, s.id)).rejects.toThrow(/full/);

    const page = (await getSession(s.id, ama))!;
    expect(page).toMatchObject({ joined: true, full: true, state: "upcoming" });
    expect(page.session.callUrl).toBe(s.callUrl);
    expect(page.attendees.map((a) => a.userId).sort()).toEqual([ama.id, kofi.id].sort());
    expect(JSON.stringify(page.attendees)).not.toContain("@agod.test");

    const [confirmation] = mailTo(ama.email, /^You're in: Build your first app with AI$/);
    expect(confirmation.text).toContain("https://meet.google.com/abc-defg-hij");
    expect(confirmation.attachments).toEqual([{ filename: "session.ics", bytes: expect.any(Number) }]);
    const ics = readFileSync(path.join(outbox, `${confirmation.id}-session.ics`), "utf8");
    expect(ics).toContain(`DTSTART:${s.startsAt.toISOString().replace(/[-:]/g, "").replace(".000", "")}`);
    expect(ics).toContain(`URL:http://localhost:3000/sessions/${s.id}`);

    await leaveSession(kofi, s.id);
    await joinSession(late, s.id);
    await expect(leaveSession(kofi, s.id)).rejects.toThrow(/haven't joined/);
    expect(await sessionsTakenPart(ama)).toEqual({ joined: 1, hosted: 0 });
    expect(await sessionsTakenPart(host)).toEqual({ joined: 0, hosted: 1 });
  });
});

describe("changes, cancellations and reminders", () => {
  it("tells people who joined about a new time, and reminds them once on the day", async () => {
    const host = await member({ reviewer: true });
    const s = await createSession(host, input({ capacity: "5" }));
    const a = await member();
    const b = await member();
    await joinSession(a, s.id);
    await joinSession(b, s.id);
    await joinSession(await member(), s.id);
    await expect(updateSession(host, s.id, input({ capacity: "2" }))).rejects.toThrow(/3 people already joined/);
    await expect(updateSession(a, s.id, input())).rejects.toThrow(/not found/);

    // Same time: nobody is emailed.
    await updateSession(host, s.id, input({ title: "Build your first app with AI (v2)", capacity: "5" }));
    expect(mailTo(a.email, /^Changed/)).toHaveLength(0);
    const moved = await updateSession(host, s.id, input({ title: "Build your first app with AI (v2)", time: "19:30", capacity: "5" }));
    expect(mailTo(a.email, /^Changed: Build your first app with AI \(v2\)$/)).toHaveLength(1);
    expect(moved.startsAt.toISOString()).toMatch(/T19:30:00/);

    // Reminders go out for sessions starting in the next 24 hours, once.
    const now = new Date();
    await shift(s.id, new Date(now.getTime() + 5 * 3_600_000));
    const first = await sendSessionReminders(now);
    expect(first.sent).toBeGreaterThanOrEqual(3);
    expect(mailTo(a.email, /^Today: /)).toHaveLength(1);
    await sendSessionReminders(now);
    expect(mailTo(a.email, /^Today: /)).toHaveLength(1);
    const later = await createSession(host, input({ title: "Next week" }));
    await joinSession(a, later.id);
    await sendSessionReminders(now);
    expect(mailTo(a.email, /^Today: Next week/)).toHaveLength(0);
  });

  it("cancels (host or organizer) with an email, and drops the session from the board", async () => {
    const host = await member({ reviewer: true });
    const s = await createSession(host, input({ title: `Cancel me ${randomUUID().slice(0, 4)}` }));
    const a = await member();
    await joinSession(a, s.id);
    const stranger = await member();
    await expect(cancelSession(stranger, s.id, { reason: "Not mine" })).rejects.toThrow(/not found/);
    await cancelSession(host, s.id, { reason: "Power outage in Kumasi" });
    const mail = mailTo(a.email, /^Cancelled: /)[0];
    expect(mail.text).toContain("Power outage in Kumasi");
    expect(readFileSync(path.join(outbox, `${mail.id}-session.ics`), "utf8")).toContain("STATUS:CANCELLED");
    expect((await listSessions("upcoming", { hostId: host.id })).sessions.map((x) => x.id)).not.toContain(s.id);
    expect((await getSession(s.id, null))!.state).toBe("cancelled");
    await expect(joinSession(stranger, s.id)).rejects.toThrow(/cancelled/);
    await expect(sendSessionReminders()).resolves.toBeTruthy();

    const other = await createSession(host, input({ title: "Organizer cancels" }));
    const org = await member();
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    await cancelSession(org, other.id, { reason: "Duplicate session" });
  });
});

describe("after the session", () => {
  it("the host adds the recording and notes; past sessions form the archive", async () => {
    const host = await member({ reviewer: true });
    const s = await createSession(host, input({ title: `Archive ${randomUUID().slice(0, 4)}` }));
    await expect(addRecording(host, s.id, { recordingUrl: "https://youtu.be/x", notes: "" })).rejects.toThrow(/once the session has started/);
    await shift(s.id, new Date(Date.now() - 3 * 3_600_000));
    await expect(addRecording(host, s.id, { recordingUrl: "", notes: "" })).rejects.toThrow(/recording link or some notes/);
    await expect(addRecording(await member(), s.id, { recordingUrl: "https://youtu.be/x", notes: "" })).rejects.toThrow(/not found/);
    await addRecording(host, s.id, { recordingUrl: "youtu.be/abc123", notes: "Slides: https://example.com/slides" });
    const page = (await getSession(s.id, null))!;
    expect(page.state).toBe("past");
    expect(page.session).toMatchObject({ recordingUrl: "https://youtu.be/abc123", notes: "Slides: https://example.com/slides" });
    const past = await listSessions("past", { hostId: host.id });
    expect(past.sessions[0]).toMatchObject({ id: s.id, recordingUrl: "https://youtu.be/abc123" });
    await expect(joinSession(await member(), s.id)).rejects.toThrow(/over/);
  });
});

describe("moderation", () => {
  it("organizers hide reported sessions and can show them again", async () => {
    const host = await member({ reviewer: true });
    const s = await createSession(host, input({ title: "Get rich with crypto" }));
    const reader = await member();
    const org = await member();
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    await expect(reportSession(host, s.id, { reason: "Reporting myself today" })).rejects.toThrow(/your own/);
    const report = await reportSession(reader, s.id, { reason: "This is a crypto scam pitch" });
    expect((await listReports(org)).find((r) => r.id === report.id)).toMatchObject({ target_type: "SESSION", target_name: "Get rich with crypto", target_link: `/sessions/${s.id}` });
    await resolveReport(org, report.id, { action: "HIDE", note: "Scam" });
    expect(await getSession(s.id, reader)).toBeNull();
    expect(await getSession(s.id, host)).not.toBeNull();
    await expect(joinSession(reader, s.id)).rejects.toThrow(/not found/);
    await unhideSession(org, s.id);
    expect(await getSession(s.id, reader)).not.toBeNull();
  });

  it("keeps session tables away from the app role", async () => {
    const actor = await createUser("ADMIN");
    await expectDbError(withActor(actor, (tx) => tx.select().from(communitySessions)), /permission denied/);
    await expectDbError(withActor(actor, (tx) => tx.select().from(communitySessionAttendees)), /permission denied/);
  });
});
