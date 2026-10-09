import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { articles, chatMessages, communityJobs, memberProfiles, riskFlags, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Member, acceptConduct, ensureProfile } from "@/modules/community";
import { createArticle } from "@/modules/community/articles";
import { postMessage } from "@/modules/community/chat";
import { createJob, getJob, listJobs } from "@/modules/community/jobs";
import { requestMentor } from "@/modules/community/mentorship";
import { addDays } from "@/modules/notifications/deadlines";
import { platformLog } from "@/modules/platform";
import { banAndCleanUp, clearFlag, heldJobs, hideFlagged, riskQueue, safetyProfile, setTrusted } from "@/modules/safety";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 41: trust & safety.

async function member(name: string, o: { daysOld?: number; verified?: boolean } = {}): Promise<Member & { handle: string }> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: o.verified ?? true, createdAt: new Date(Date.now() - (o.daysOld ?? 10) * 86_400_000) });
  const p = await ensureProfile(m);
  await acceptConduct(m);
  return { ...m, handle: p.handle };
}

async function staff() {
  const s = await member("Safety staff");
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", s.email);
  return s;
}

const today = todayInOperatingZone();
const job = (extra: Record<string, unknown> = {}) => ({
  hirer: "Kente Pay",
  title: `Checkout page ${randomUUID().slice(0, 6)}`,
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

describe("trust & safety", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps new accounts from posting jobs, links in chat and mentor requests until established or trusted", async () => {
    const s = await staff();
    const fresh = await member("Fresh", { daysOld: 0 });
    const unconfirmed = await member("Unconfirmed", { verified: false });
    await expect(createJob(fresh, job())).rejects.toThrow(/Posting jobs: New accounts can do this 3 days after joining/);
    await expect(createJob(unconfirmed, job())).rejects.toThrow(/Confirm your email/);
    await expect(postMessage(fresh, "general", { body: "Free course at https://example.com/learn" })).rejects.toThrow(/Sharing links in the chat/);
    // Chatting without links is fine from day one.
    expect(await postMessage(fresh, "general", { body: "Hello everyone, I just joined!" })).toBeTruthy();
    const mentor = await member("Mentor");
    await db.update(memberProfiles).set({ mentorOpen: true, mentorCapacity: 3, reviewer: true }).where(eq(memberProfiles.userId, mentor.id));
    await expect(requestMentor(fresh, mentor.handle, { goal: "Ship my first app with a safe login" })).rejects.toThrow(/Asking for a mentor/);

    // Staff lift the limits early for someone they know.
    await setTrusted(s, fresh.id, true);
    expect(await createJob(fresh, job())).toBeTruthy();
    expect((await safetyProfile(s, fresh.id))!.standing).toMatchObject({ newAccount: false, trusted: true });
    await setTrusted(s, fresh.id, false);
    expect((await safetyProfile(s, fresh.id))!.standing.newAccount).toBe(true);
  });

  it("holds a scam-looking job until staff approve it, and lists it in the queue", async () => {
    const s = await staff();
    const poster = await member("Recruiter");
    const reader = await member("Reader");
    const clean = await createJob(poster, job());
    const scam = await createJob(poster, job({ title: `Data entry ${randomUUID().slice(0, 6)}`, description: "Easy work from home. Pay a refundable deposit to start, then send your MoMo PIN so we can pay you." }));

    const listed = (await listJobs()).map((j) => j.id);
    expect(listed).toContain(clean);
    expect(listed).not.toContain(scam);
    expect(await getJob(reader, scam)).toBeNull();
    expect(await getJob(poster, scam)).toMatchObject({ held: true, open: false });

    const queue = await riskQueue(s);
    const flag = queue.find((q) => q.targetId === scam)!;
    expect(flag).toMatchObject({ targetType: "JOB", kind: "Job", link: `/jobs/${scam}`, author: { id: poster.id } });
    expect(flag.signals).toEqual(expect.arrayContaining(["Asks people to pay (fee, deposit or charge)", "Asks for a PIN, code, password or ID"]));
    expect(queue.some((q) => q.targetId === clean)).toBe(false);
    expect((await heldJobs(s)).map((j) => j.id)).toContain(scam);

    await clearFlag(s, flag.id);
    expect((await listJobs()).map((j) => j.id)).toContain(scam);
    expect((await platformLog(s))[0]).toMatchObject({ action: "JOB_APPROVED" });
    await expect(clearFlag(s, flag.id)).rejects.toThrow("already dealt with");
  });

  it("flags phishing links in chat and hides flagged content on request", async () => {
    const s = await staff();
    const author = await member("Linker");
    const id = await postMessage(author, "general", { body: "Claim your MTN bonus here: https://mtn-momo-bonus.xyz/claim" });
    const flag = (await riskQueue(s)).find((q) => q.targetId === id)!;
    expect(flag.signals).toContain("Address pretends to be mtn");
    await expect(hideFlagged(s, flag.id, "no")).rejects.toThrow("Give a reason");
    await hideFlagged(s, flag.id, "Phishing link");
    const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    expect(m.hiddenReason).toBe("Phishing link");
    const [f] = await db.select().from(riskFlags).where(eq(riskFlags.id, flag.id));
    expect(f.status).toBe("ACTIONED");

    const ok = await postMessage(author, "general", { body: "The Next.js docs are great: https://nextjs.org/docs" });
    expect((await riskQueue(s)).some((q) => q.targetId === ok)).toBe(false);
  });

  it("bans someone and hides everything they posted in one go", async () => {
    const s = await staff();
    const scammer = await member("Scammer");
    const jobId = await createJob(scammer, job());
    const articleId = await createArticle(scammer, { title: "Earn money fast online", summary: "Double your money in a week with forex.", body: "Guaranteed profit. WhatsApp me on 024 123 4567 to invest just GHS 200.", tags: "" });
    const chatId = await postMessage(scammer, "general", { body: "DM me for jobs" });

    const hidden = await banAndCleanUp(s, scammer.id, "Running an investment scam");
    expect(hidden).toBeGreaterThanOrEqual(4); // profile, job, article, chat message
    const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, scammer.id));
    expect(u.active).toBe(false);
    for (const [table, id] of [
      [communityJobs, jobId],
      [articles, articleId],
      [chatMessages, chatId],
    ] as const) {
      const [row] = await db.select({ hiddenAt: table.hiddenAt }).from(table).where(eq(table.id, id));
      expect(row.hiddenAt).not.toBeNull();
    }
    expect((await riskQueue(s)).some((q) => q.author.id === scammer.id)).toBe(false);
    expect((await platformLog(s)).find((l) => l.action === "BANNED_AND_CLEANED")).toMatchObject({ reason: "Running an investment scam" });

    // Staff can't ban themselves or other staff.
    await expect(banAndCleanUp(s, s.id, "Testing myself")).rejects.toThrow("your own login");
  });

  it("is only for staff", async () => {
    const outsider = await member("Outsider");
    await expect(riskQueue(outsider)).rejects.toThrow("Only AGOD back-office staff");
    await expect(banAndCleanUp(outsider, outsider.id, "Testing access")).rejects.toThrow("Only AGOD back-office staff");
    await expect(setTrusted(outsider, outsider.id, true)).rejects.toThrow("Only AGOD back-office staff");
  });
});
