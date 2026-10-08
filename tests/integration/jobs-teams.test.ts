import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { communityJobs, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Member, acceptConduct, ensureProfile, listReports, resolveReport } from "@/modules/community";
import { applyToJob, closeJob, createJob, getJob, listJobs, myJobs, reportJob, setApplicationStatus, updateJob, withdrawApplication } from "@/modules/community/jobs";
import {
  answerTeamRequest,
  closeTeamPost,
  createTeamPost,
  getTeamPost,
  listTeamPosts,
  myTeams,
  reportTeamPost,
  sendTeamRequest,
  withdrawTeamRequest,
} from "@/modules/community/teams";
import { addDays } from "@/modules/notifications/deadlines";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 33: the jobs & gigs board and the team finder.

let outbox = "";
beforeEach(() => {
  outbox = mkdtempSync(path.join(tmpdir(), "agod-outbox-"));
  vi.stubEnv("EMAIL_OUTBOX_DIR", outbox);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());
const mails = () => readdirSync(outbox).map((f) => JSON.parse(readFileSync(path.join(outbox, f), "utf8")) as { to: string; subject: string; text: string });

async function member(name = "Builder", conduct = true): Promise<Member> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  await ensureProfile(m);
  if (conduct) await acceptConduct(m);
  return m;
}

const today = todayInOperatingZone();
const job = (extra: Record<string, unknown> = {}) => ({
  hirer: "Kente Pay",
  title: `MoMo checkout ${randomUUID().slice(0, 6)}`,
  kind: "GIG" as const,
  workMode: "REMOTE" as const,
  location: "",
  payMin: "2500",
  payMax: "4000",
  payUnit: "PROJECT" as const,
  description: "Build a mobile money checkout page for our shop, with tests and a short handover call.",
  skills: "React, Payments",
  closesOn: addDays(today, 14),
  ...extra,
});

describe("jobs board", () => {
  it("jobs must state pay, can't ask for fees, and stay open at most 60 days", async () => {
    const poster = await member("Poster");
    await expect(createJob(poster, job({ payMin: "" }))).rejects.toThrow(/always show the pay/);
    await expect(createJob(poster, job({ payUnit: "" }))).rejects.toThrow(/for the work, a month or an hour/);
    await expect(createJob(poster, job({ payMax: "100" }))).rejects.toThrow(/at least the pay/);
    await expect(createJob(poster, job({ description: "Great job. Pay a registration fee of GHS 200 and start this week, no experience needed." }))).rejects.toThrow(/never ask applicants to pay/);
    await expect(createJob(poster, job({ workMode: "ONSITE" }))).rejects.toThrow(/where the work is/);
    await expect(createJob(poster, job({ closesOn: addDays(today, 61) }))).rejects.toThrow(/at most 60 days/);
    await expect(createJob(poster, job({ closesOn: addDays(today, -1) }))).rejects.toThrow(/has passed/);
    const id = await createJob(poster, job({ kind: "INTERNSHIP", payMin: "", payMax: "", payUnit: "", workMode: "HYBRID", location: "Accra" }));
    const [row] = await db.select().from(communityJobs).where(eq(communityJobs.id, id));
    expect(row).toMatchObject({ kind: "INTERNSHIP", payMinMinor: null, payUnit: null, location: "Accra" });
    const paid = await createJob(poster, job({ payMin: "2,500.50" }));
    expect((await getJob(null, paid))!).toMatchObject({ payMinMinor: 250050, payMaxMinor: 400000, payUnit: "PROJECT", open: true });
    const noConduct = await member("New", false);
    await expect(createJob(noConduct, job())).rejects.toThrow(/code of conduct/);
  });

  it("apply, shortlist (shares the poster's email), hire, decline, withdraw", async () => {
    const poster = await member("Poster");
    const ama = await member("Ama");
    const kofi = await member("Kofi");
    const id = await createJob(poster, job({ title: "Shop checkout gig" }));
    expect((await listJobs({ q: "Shop checkout" })).map((j) => j.id)).toContain(id);
    expect((await listJobs({ kind: "JOB", q: "Shop checkout" })).map((j) => j.id)).not.toContain(id);
    expect((await listJobs({ skill: "payments", q: "Shop checkout" })).map((j) => j.id)).toContain(id);

    await expect(applyToJob(poster, id, { message: "I would love to do my own job please", link: "" })).rejects.toThrow(/your own job/);
    await expect(applyToJob(ama, id, { message: "Hire me", link: "" })).rejects.toThrow(/at least 20/);
    const appA = await applyToJob(ama, id, { message: "I built two MoMo checkouts with Paystack last year.", link: "ama.dev" });
    await expect(applyToJob(ama, id, { message: "I built two MoMo checkouts with Paystack last year.", link: "" })).rejects.toThrow(/already applied/);
    const appK = await applyToJob(kofi, id, { message: "I know React and the Hubtel API very well.", link: "" });
    expect(mails().some((m) => m.to === poster.email && m.subject.includes("Ama applied"))).toBe(true);

    // The poster sees applicants with their email; applicants don't see the poster's email yet.
    const posted = (await myJobs(poster)).posted.find((j) => j.id === id)!;
    expect(posted.applications.map((a) => [a.person.name, a.person.email])).toEqual([
      ["Kofi", kofi.email],
      ["Ama", ama.email],
    ]);
    expect((await myJobs(ama)).applied[0]).toMatchObject({ status: "SENT", link: "https://ama.dev", person: { email: null } });

    await expect(setApplicationStatus(ama, appK, "HIRED")).rejects.toThrow(/not found/);
    await setApplicationStatus(poster, appA, "SHORTLISTED");
    expect((await myJobs(ama)).applied[0]).toMatchObject({ status: "SHORTLISTED", person: { email: poster.email } });
    expect(mails().some((m) => m.to === ama.email && /shortlisted/.test(m.subject) && m.text.includes(poster.email))).toBe(true);
    await setApplicationStatus(poster, appA, "HIRED");
    await setApplicationStatus(poster, appK, "DECLINED");
    await expect(setApplicationStatus(poster, appK, "SHORTLISTED")).rejects.toThrow(/can't be changed/);
    expect(mails().some((m) => m.to === kofi.email && m.subject.startsWith("Update on") && !m.text.includes(poster.email))).toBe(true);
    await expect(withdrawApplication(kofi, appK)).rejects.toThrow(/no open application/);

    await closeJob(poster, id, true);
    expect((await getJob(null, id))!).toMatchObject({ status: "FILLED", open: false });
    expect((await listJobs({ q: "Shop checkout" })).map((j) => j.id)).not.toContain(id);
    const esi = await member("Esi");
    await expect(applyToJob(esi, id, { message: "Is this still open? I can start today.", link: "" })).rejects.toThrow(/no longer taking/);
    await expect(updateJob(poster, id, job())).rejects.toThrow(/closed/);
  });

  it("withdraw and apply again; only the poster edits", async () => {
    const poster = await member("Poster");
    const ama = await member("Ama");
    const id = await createJob(poster, job());
    const app = await applyToJob(ama, id, { message: "I can build this in two weeks with tests.", link: "" });
    await withdrawApplication(ama, app);
    expect(await applyToJob(ama, id, { message: "Sorry, I can do it after all, in two weeks.", link: "" })).toBe(app);
    await expect(updateJob(ama, id, job())).rejects.toThrow(/Only the person/);
    await updateJob(poster, id, job({ title: "MoMo checkout (updated)" }));
    expect((await getJob(null, id))!.title).toBe("MoMo checkout (updated)");
  });

  it("organizers hide reported jobs", async () => {
    const org = await member("Organizer");
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    const poster = await member("Poster");
    const reader = await member("Reader");
    const id = await createJob(poster, job({ title: "Suspicious offer" }));
    await expect(reportJob(poster, id, { reason: "Reporting my own job for fun" })).rejects.toThrow(/own job/);
    await reportJob(reader, id, { reason: "They asked me on WhatsApp to pay first" });
    const report = (await listReports(org)).find((r) => r.target_link === `/jobs/${id}`)!;
    expect(report).toMatchObject({ target_type: "JOB", target_name: "Suspicious offer" });
    await resolveReport(org, report.id, { action: "HIDE", note: "Asked for money" });
    expect(await getJob(reader, id)).toBeNull();
    expect((await getJob(poster, id))!.hidden).toBe(true);
    expect((await listJobs({ q: "Suspicious offer" })).length).toBe(0);
  });
});

const idea = (extra: Record<string, unknown> = {}) => ({
  kind: "IDEA" as const,
  title: `Trotro times ${randomUUID().slice(0, 6)}`,
  description: "An app that shows when the next trotro leaves from Circle.",
  roles: "Designer, Backend developer",
  tools: "Lovable, Supabase",
  commitment: "5 hours a week",
  reward: "LEARNING" as const,
  ...extra,
});

describe("team finder", () => {
  it("request, accept (shares emails both ways), decline can't be re-sent, withdraw", async () => {
    const author = await member("Author");
    const ama = await member("Ama");
    const kofi = await member("Kofi");
    await expect(createTeamPost(author, idea({ roles: "" }))).rejects.toThrow(/at least 1/);
    const id = await createTeamPost(author, idea({ title: "Trotro times app" }));
    expect((await listTeamPosts({ role: "designer", q: "Trotro times app" })).map((p) => p.id)).toEqual([id]);
    expect((await listTeamPosts({ kind: "JOINING", q: "Trotro times app" })).length).toBe(0);

    await expect(sendTeamRequest(author, id, { message: "Joining my own team" })).rejects.toThrow(/your own post/);
    const reqA = await sendTeamRequest(ama, id, { message: "I'm a designer and I ride trotros every day." });
    await expect(sendTeamRequest(ama, id, { message: "Me again, still keen to help" })).rejects.toThrow(/already sent/);
    expect(mails().some((m) => m.to === author.email && m.subject.includes("Ama wants to join"))).toBe(true);
    const reqK = await sendTeamRequest(kofi, id, { message: "I can build the backend in Supabase." });

    expect((await myTeams(author)).posts[0].requests.map((r) => [r.person.name, r.person.email])).toEqual([
      ["Kofi", null],
      ["Ama", null],
    ]);
    await expect(answerTeamRequest(ama, reqK, { accept: true, note: "" })).rejects.toThrow(/not found/);
    await answerTeamRequest(author, reqA, { accept: true, note: "Welcome!" });
    await answerTeamRequest(author, reqK, { accept: false, note: "We found someone" });
    expect((await myTeams(author)).posts[0].requests.find((r) => r.id === reqA)!.person.email).toBe(ama.email);
    expect((await myTeams(ama)).sent[0]).toMatchObject({ status: "ACCEPTED", person: { email: author.email } });
    expect(mails().some((m) => m.to === ama.email && m.text.includes(author.email))).toBe(true);
    await expect(sendTeamRequest(kofi, id, { message: "Please reconsider, I'm good" })).rejects.toThrow(/said no/);

    const esi = await member("Esi");
    const reqE = await sendTeamRequest(esi, id, { message: "I can test it on my phone." });
    await withdrawTeamRequest(esi, reqE);
    expect(await sendTeamRequest(esi, id, { message: "Back again, I can test it." })).toBe(reqE);

    await closeTeamPost(author, id);
    await expect(sendTeamRequest(await member("Yaw"), id, { message: "Can I still join please?" })).rejects.toThrow(/closed/);
    expect((await listTeamPosts({ q: "Trotro times app" })).length).toBe(0);
  });

  it("at most 3 open posts; reported posts can be hidden", async () => {
    const author = await member("Busy");
    for (let i = 0; i < 3; i++) await createTeamPost(author, idea({ kind: "JOINING", roles: "Frontend developer" }));
    await expect(createTeamPost(author, idea())).rejects.toThrow(/3 open posts/);

    const org = await member("Organizer");
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    const reader = await member("Reader");
    const id = (await myTeams(author)).posts[0].id;
    await reportTeamPost(reader, id, { reason: "This post is spam about crypto" });
    const report = (await listReports(org)).find((r) => r.target_link === `/teams/${id}`)!;
    expect(report.target_type).toBe("TEAM");
    await resolveReport(org, report.id, { action: "HIDE", note: "Spam" });
    expect(await getTeamPost(reader, id)).toBeNull();
    expect((await getTeamPost(author, id))!.hidden).toBe(true);
  });
});
