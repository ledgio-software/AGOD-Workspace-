import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memberProfiles, projectOfMonth, users } from "@/lib/db/schema";
import { type Member, acceptConduct, ensureProfile, listReports, resolveReport, updateProfile } from "@/modules/community";
import { createItem, getItem, listItems, reportItem, setFeatured, toggleUseful, updateItem } from "@/modules/community/library";
import {
  answerRequest,
  endMentorship,
  listMentors,
  mentoredCount,
  myMentorships,
  requestMentor,
  updateMentorSettings,
  withdrawRequest,
} from "@/modules/community/mentorship";
import { latestProjectOfMonth, monthsWon, myVote, pickProjectOfMonth, settleMonth, standings, voteForProject } from "@/modules/community/project-month";
import { createPost } from "@/modules/community/showcase";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 31: mentorship, the tools & prompts library, project of the month.

let outbox = "";
beforeEach(() => {
  outbox = mkdtempSync(path.join(tmpdir(), "agod-outbox-"));
  vi.stubEnv("EMAIL_OUTBOX_DIR", outbox);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());
const mails = () => readdirSync(outbox).map((f) => JSON.parse(readFileSync(path.join(outbox, f), "utf8")) as { to: string; subject: string; text: string });

async function member(name = "Builder", extra: { tools?: string; city?: string; reviewer?: boolean } = {}): Promise<Member> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  // Established accounts (Phase 41: new accounts can't post jobs or ask mentors for their first days).
  await db.insert(users).values({ ...m, emailVerified: true, createdAt: new Date(Date.now() - 10 * 86_400_000) });
  const p = await ensureProfile(m);
  await acceptConduct(m);
  if (extra.tools || extra.city || extra.reviewer) {
    await updateProfile(m, {
      handle: p.handle,
      headline: "",
      bio: "",
      city: extra.city ?? "",
      tools: extra.tools ?? "",
      websiteUrl: "",
      githubUrl: "",
      linkedinUrl: "",
      xUrl: "",
      reviewer: extra.reviewer ?? false,
      wantsMentor: false,
      visibility: "PUBLIC",
    });
  }
  return m;
}
const handleOf = async (m: Member) => (await db.select({ h: memberProfiles.handle }).from(memberProfiles).where(eq(memberProfiles.userId, m.id)))[0].h;

describe("mentorship", () => {
  it("matches by shared tools and city, and only Reviewers can mentor", async () => {
    const tool = `Tool${randomUUID().slice(0, 6)}`;
    const me = await member("Ama", { tools: `${tool}, React`, city: "Kumasi" });
    const near = await member("Kofi", { tools: tool, city: "Kumasi", reviewer: true });
    const far = await member("Efua", { tools: "Go", city: "Tamale", reviewer: true });
    const plain = await member("Yaw");
    await expect(updateMentorSettings(plain, { open: true, capacity: 2, note: "" })).rejects.toThrow(/Reviewer/);
    await updateMentorSettings(near, { open: true, capacity: 1, note: "Lovable and prompting" });
    await updateMentorSettings(far, { open: true, capacity: 2, note: "" });
    const list = (await listMentors(me, { q: "" })).filter((m) => [near.id, far.id].includes(m.userId));
    expect(list.map((m) => m.userId)).toEqual([near.id, far.id]);
    expect(list[0]).toMatchObject({ sharedTools: [tool], sameCity: true, hasSpace: true });
  });

  it("request → accept shares emails; capacity, limits, withdraw and end", async () => {
    const mentor = await member("Kofi Mentor", { reviewer: true });
    await updateMentorSettings(mentor, { open: true, capacity: 1, note: "" });
    const a = await member("Ama");
    const b = await member("Esi");
    const handle = await handleOf(mentor);
    await expect(requestMentor(a, handle, { goal: "short" })).rejects.toThrow(/at least 10/);
    const id = await requestMentor(a, handle, { goal: "Ship my first app with a safe login" });
    await expect(requestMentor(a, handle, { goal: "Ship my first app with a safe login" })).rejects.toThrow(/already asked/);
    expect(mails().some((m) => m.to === mentor.email && /would like you to mentor them/.test(m.subject))).toBe(true);
    expect((await myMentorships(a)).asMentee[0]).toMatchObject({ status: "PENDING", other: { email: null } });

    const idB = await requestMentor(b, handle, { goal: "Learn how to review code" });
    await expect(answerRequest(a, id, { accept: true, note: "" })).rejects.toThrow(/not found/);
    await answerRequest(mentor, id, { accept: true, note: "Happy to help" });
    expect((await myMentorships(a)).asMentee[0]).toMatchObject({ status: "ACTIVE", other: { email: mentor.email } });
    expect(mails().some((m) => m.to === a.email && /will mentor you/.test(m.subject) && m.text.includes(mentor.email))).toBe(true);
    // Full now: the second request can't be accepted, and nobody new can ask.
    await expect(answerRequest(mentor, idB, { accept: true, note: "" })).rejects.toThrow(/as many people/);
    const c = await member("Kwesi");
    await expect(requestMentor(c, handle, { goal: "Help me with my portfolio" })).rejects.toThrow(/no space/);
    await withdrawRequest(b, idB);
    await endMentorship(a, id);
    expect(await mentoredCount(mentor.id)).toBe(1);
    await expect(requestMentor(mentor, handle, { goal: "Mentor myself please" })).rejects.toThrow(/yourself/);
  });

  it("a member asks at most two mentors at a time", async () => {
    const mentors = await Promise.all([1, 2, 3].map(async (i) => {
      const m = await member(`Mentor ${i}`, { reviewer: true });
      await updateMentorSettings(m, { open: true, capacity: 3, note: "" });
      return handleOf(m);
    }));
    const me = await member("Busy learner");
    await requestMentor(me, mentors[0], { goal: "Help with my first API" });
    await requestMentor(me, mentors[1], { goal: "Help with my first API" });
    await expect(requestMentor(me, mentors[2], { goal: "Help with my first API" })).rejects.toThrow(/2 mentors at a time/);
  });
});

const prompt = (extra: Record<string, unknown> = {}) => ({
  kind: "PROMPT" as const,
  title: "Safe login checklist",
  summary: "Ask the AI to review your login for common mistakes.",
  url: "",
  body: "Review this login code for: secrets in the code, missing rate limits, ...",
  tags: "Security, Prompting",
  lowData: true,
  free: true,
  ...extra,
});

describe("tools & prompts library", () => {
  it("prompts need the text, tools need a link; useful marks, not your own", async () => {
    const author = await member("Author");
    const reader = await member("Reader");
    await expect(createItem(author, prompt({ body: "" }))).rejects.toThrow(/Paste the prompt/);
    await expect(createItem(author, prompt({ kind: "TOOL", url: "" }))).rejects.toThrow(/Add the link/);
    const id = await createItem(author, prompt());
    const toolId = await createItem(author, prompt({ kind: "TOOL", title: `Hoppscotch ${randomUUID().slice(0, 4)}`, url: "hoppscotch.io", body: "" }));
    expect((await getItem(null, toolId))!.url).toBe("https://hoppscotch.io");
    await expect(toggleUseful(author, id)).rejects.toThrow(/own item/);
    expect(await toggleUseful(reader, id)).toBe(true);
    expect((await getItem(reader, id))!).toMatchObject({ useful: 1, markedByMe: true });
    expect(await toggleUseful(reader, id)).toBe(false);
    await expect(updateItem(reader, id, prompt({ title: "Mine now" }))).rejects.toThrow(/Only the person/);
    const found = await listItems(null, { kind: "PROMPT", tag: "security", q: "Safe login" });
    expect(found.some((i) => i.id === id)).toBe(true);
    expect((await listItems(null, { kind: "TOOL" })).every((i) => i.kind === "TOOL")).toBe(true);
  });

  it("organizers feature items and hide reported ones", async () => {
    const org = await member("Organizer");
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    const author = await member("Author");
    const reader = await member("Reader");
    const id = await createItem(author, prompt({ title: `Featured ${randomUUID().slice(0, 6)}` }));
    await expect(setFeatured(reader, id, true)).rejects.toThrow(/organizers/);
    await setFeatured(org, id, true);
    expect((await listItems(null))[0].id).toBe(id);
    await reportItem(reader, id, { reason: "This prompt asks people to paste their passwords" });
    const report = (await listReports(org)).find((r) => r.target_link === `/library/${id}`)!;
    expect(report.target_type).toBe("LIBRARY");
    await resolveReport(org, report.id, { action: "HIDE", note: "Unsafe advice" });
    expect(await getItem(reader, id)).toBeNull();
    expect((await getItem(author, id))!.hidden).toBe(true);
  });
});

describe("project of the month", () => {
  it("one vote a month, not your own; the leader wins when the month ends; organizers can pick", async () => {
    const authorA = await member("Author A");
    const authorB = await member("Author B");
    const post = (title: string) =>
      ({ title, pitch: "Helps market women track MoMo sales.", audience: "", builtWith: "Lovable", aiBuilt: true, liveUrl: "", repoUrl: "", videoUrl: "", feedbackAreas: [], feedbackWanted: "", stuckOn: "", needs: [], visibility: "PUBLIC" as const, safety: true as const });
    const a = (await createPost(authorA, post("Market Mama"))).id;
    const b = (await createPost(authorB, post("Trotro Times"))).id;
    // A month far in the past, different on every run, so this test owns it.
    const Y = String(1100 + Math.floor(Math.random() * 800));
    const M = `${Y}-03`;
    const at = (d: string) => new Date(`${Y}-${d}T12:00:00Z`);
    const when = at("03-10");
    const voters = await Promise.all([1, 2, 3].map((i) => member(`Voter ${i}`)));
    await expect(voteForProject(authorA, a, when)).rejects.toThrow(/own project/);
    expect(await voteForProject(voters[0], a, when)).toBe("voted");
    expect(await voteForProject(voters[1], a, when)).toBe("voted");
    expect(await voteForProject(voters[2], a, when)).toBe("voted");
    expect(await voteForProject(voters[2], b, at("03-11"))).toBe("moved");
    expect(await voteForProject(voters[1], a, when)).toBe("removed");
    expect(await myVote(voters[2], when)).toBe(b);
    expect((await standings(M)).map((s) => [s.postId, s.votes])).toEqual([
      [a, 1],
      [b, 1],
    ]);
    // Not settled while the month is running; then the first to reach the top count wins.
    expect(await settleMonth(M, when)).toBeNull();
    expect(await settleMonth(M, at("04-02"))).toBe(a);
    expect((await monthsWon([a])).get(a)).toEqual([M]);
    const latest = await latestProjectOfMonth(at("04-15"));
    expect(latest).toMatchObject({ month: M, postId: a, title: "Market Mama", picked: false });

    const org = await member("Organizer");
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    await expect(pickProjectOfMonth(voters[0], M, b, null)).rejects.toThrow(/organizers/);
    await pickProjectOfMonth(org, M, b, "Most helpful to the community this month");
    const [row] = await db.select().from(projectOfMonth).where(eq(projectOfMonth.month, M));
    expect(row).toMatchObject({ postId: b, pickedBy: org.id, note: "Most helpful to the community this month" });
  });
});
