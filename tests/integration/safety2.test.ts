import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appeals, articles, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Member, acceptConduct, ensureProfile, updateProfile } from "@/modules/community";
import { createArticle, setPublished, toggleUseful } from "@/modules/community/articles";
import { postMessage } from "@/modules/community/chat";
import { createJob, getJob, listJobs } from "@/modules/community/jobs";
import { voteForProject } from "@/modules/community/project-month";
import { createPost } from "@/modules/community/showcase";
import { addDays } from "@/modules/notifications/deadlines";
import { platformLog } from "@/modules/platform";
import { banAndCleanUp, discountVotes, heldJobs, linkedTo, riskQueue, setVerifiedHirer, voteQueue } from "@/modules/safety";
import { decideAppeal, myHiddenItems, openAppeals, submitAccountAppeal, submitContentAppeal } from "@/modules/safety/appeals";
import { recordLogin } from "@/modules/safety/links";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 42: trust & safety tier 2.

const letters = (n = 10) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const ip = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join(".")}`;
const UA = "Mozilla/5.0 (Linux; Android 14) Chrome/129.0.6668.70 Mobile";

async function member(name: string, o: { daysOld?: number; verified?: boolean; email?: string } = {}): Promise<Member & { handle: string }> {
  const id = randomUUID();
  const m = { id, name, email: o.email ?? `${id}@agod.test` };
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
  closesOn: addDays(todayInOperatingZone(), 14),
  ...extra,
});

describe("trust & safety tier 2", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("links accounts that share a quiet network or a look-alike email, but not a busy network", async () => {
    const s = await staff();
    const home = ip();
    const a = await member("Ama A");
    const b = await member("Ama B");
    await recordLogin(a.id, home, UA);
    await recordLogin(b.id, home, UA.replace("129.0.6668.70", "130.0.1.2")); // a browser update is the same device
    await recordLogin(a.id, home, UA); // a second sign-in only bumps last seen
    expect((await linkedTo(s, a.id)).find((l) => l.userId === b.id)?.reasons).toEqual(["Same device and network"]);

    // A mobile network shared by many people is not a link.
    const carrier = ip();
    const crowd = await Promise.all(Array.from({ length: 9 }, (_, i) => member(`Crowd ${i}`)));
    for (const c of crowd) await recordLogin(c.id, carrier, `${UA} ${c.id}`);
    expect(await linkedTo(s, crowd[0].id)).toEqual([]);

    // ama.mensah@ and ama.mensah2+jobs@ are probably the same person.
    const base = letters();
    const e1 = await member("Look-alike 1", { email: `${base}@gmail.test` });
    const e2 = await member("Look-alike 2", { email: `${base.slice(0, 4)}.${base.slice(4)}2+jobs@gmail.test` });
    expect((await linkedTo(s, e1.id)).map((l) => [l.userId, l.reasons])).toEqual([[e2.id, ["Almost the same email"]]]);
  });

  it("flags a new account linked to a banned one, whatever it writes", async () => {
    const s = await staff();
    const net = ip();
    const scammer = await member("Banned scammer");
    await recordLogin(scammer.id, net, UA);
    await banAndCleanUp(s, scammer.id, "Fake job scam asking for fees");
    const comeback = await member("Brand new me", { daysOld: 0 });
    await recordLogin(comeback.id, net, UA);
    const id = await postMessage(comeback, "general", { body: "Hello everyone, happy to be here" });
    const flag = (await riskQueue(s)).find((q) => q.targetId === id);
    expect(flag?.signals).toEqual(expect.arrayContaining(["Linked to a banned account (Banned scammer)"]));
  });

  it("finds manufactured votes and discounts only those", async () => {
    const s = await staff();
    const author = await member("Writer");
    const articleId = await createArticle(author, { title: `Payments ${letters(6)}`, summary: "What I learned adding payments to my app.", body: "Keep the secret key on the server and call the API from there, never from the browser.", tags: "" });
    await setPublished(author, articleId, true);
    const fakes = await Promise.all([1, 2, 3].map((i) => member(`Sock ${i}`, { daysOld: 0 })));
    const real = await member("Real reader");
    for (const v of [...fakes, real]) await toggleUseful(v, articleId);

    const item = (await voteQueue(s)).find((v) => v.targetId === articleId);
    expect(item).toMatchObject({ source: "ARTICLE_USEFUL", total: 4, suspicious: 3, reasons: { newVoters: 3 }, authorId: author.id, link: `/articles/${articleId}` });
    expect(await discountVotes(s, "ARTICLE_USEFUL", articleId)).toBe(3);
    expect((await voteQueue(s)).some((v) => v.targetId === articleId)).toBe(false);
    expect((await platformLog(s)).find((l) => l.action === "VOTES_DISCOUNTED")).toMatchObject({ targetId: articleId });
    await expect(discountVotes(s, "NOPE", articleId)).rejects.toThrow("Not found");

    // New accounts can't vote for project of the month at all.
    const post = await createPost(author, { title: `Market ${letters(5)}`, pitch: "Helps market women track MoMo sales.", audience: "", builtWith: "Lovable", aiBuilt: true, liveUrl: "", repoUrl: "", videoUrl: "", feedbackAreas: [], feedbackWanted: "", stuckOn: "", needs: [], visibility: "PUBLIC", safety: true });
    await expect(voteForProject(fakes[0], post.id)).rejects.toThrow(/Voting for project of the month/);
    expect(await voteForProject(real, post.id)).toBe("voted");
  });

  it("holds jobs claiming a well-known company unless the poster is a verified hirer", async () => {
    const s = await staff();
    const poster = await member("Recruiter");
    const fake = await createJob(poster, job({ hirer: "MTN Ghana Recruitment" }));
    expect(await getJob(poster, fake)).toMatchObject({ held: true });
    expect((await heldJobs(s)).find((j) => j.id === fake)?.signals).toContain("Says it's hiring for MTN, but the poster isn't a verified hirer");

    await expect(setVerifiedHirer(s, poster.id, true, "no")).rejects.toThrow("Give a reason");
    await setVerifiedHirer(s, poster.id, true, "Called MTN HR to confirm");
    const real = await createJob(poster, job({ hirer: "MTN Ghana" }));
    const card = (await listJobs()).find((j) => j.id === real);
    expect(card).toMatchObject({ hirerVerified: true });
    expect((await platformLog(s)).find((l) => l.action === "HIRER_VERIFIED")).toMatchObject({ reason: "Called MTN HR to confirm" });
    await setVerifiedHirer(s, poster.id, false, "");
    expect((await listJobs()).find((j) => j.id === real)).toMatchObject({ hirerVerified: false });
  });

  it("keeps official-sounding profile addresses for AGOD", async () => {
    const m = await member("Kojo");
    const profile = { headline: "", bio: "", city: "", tools: "", websiteUrl: "", githubUrl: "", linkedinUrl: "", xUrl: "", reviewer: false, wantsMentor: false, visibility: "PUBLIC" as const };
    await expect(updateProfile(m, { ...profile, handle: `agod-support-${letters(4)}` })).rejects.toThrow(/kept for AGOD/);
    await expect(updateProfile(m, { ...profile, handle: `kojo-admin-${letters(4)}` })).rejects.toThrow(/"admin"/);
    expect((await updateProfile(m, { ...profile, handle: `kojo-builds-${letters(4)}` })).handle).toMatch(/^kojo-builds-/);
  });

  it("lets a blocked login and a hidden post appeal, and staff decide", async () => {
    const s = await staff();
    const person = await member("Wrongly banned");
    const articleId = await createArticle(person, { title: `My first app ${letters(5)}`, summary: "How I built a shop app for my mum.", body: "I used Lovable and Supabase, and kept the keys on the server.", tags: "" });
    await banAndCleanUp(s, person.id, "Looked like a spam account");

    // The form answers the same for anyone; only a blocked login's appeal is kept, once.
    const message = "I'm a real student at KNUST, this is my only account. Please look again.";
    await submitAccountAppeal({ email: `${letters()}@nobody.test`, message });
    await submitAccountAppeal({ email: s.email, message });
    await submitAccountAppeal({ email: person.email.toUpperCase(), message });
    await submitAccountAppeal({ email: person.email, message });
    await expect(submitAccountAppeal({ email: person.email, message: "too short" })).rejects.toThrow(/at least 20/);
    const mine = (await openAppeals(s)).filter((a) => a.email === person.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "ACCOUNT", why: "Looked like a spam account", person: { id: person.id, active: false } });
    expect((await openAppeals(s)).some((a) => a.email === s.email)).toBe(false);

    await expect(decideAppeal(s, mine[0].id, true, "ok")).rejects.toThrow(/at least 5/);
    await decideAppeal(s, mine[0].id, true, "Checked with the KNUST club lead, sorry");
    const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, person.id));
    expect(u.active).toBe(true);
    await expect(decideAppeal(s, mine[0].id, false, "Changed my mind")).rejects.toThrow("already decided");

    // Signed in again, they see what the ban hid and appeal it one by one.
    const hidden = await myHiddenItems(person);
    expect(hidden.map((h) => h.type).sort()).toEqual(["ARTICLE", "PROFILE"]);
    expect(hidden[0]).toMatchObject({ reason: "Looked like a spam account", appeal: null });
    const other = await member("Someone else");
    await expect(submitContentAppeal(other, "ARTICLE", articleId, message)).rejects.toThrow("Post not found");
    await expect(submitContentAppeal(person, "NOPE", articleId, message)).rejects.toThrow("Post not found");
    await submitContentAppeal(person, "ARTICLE", articleId, message);
    await expect(submitContentAppeal(person, "ARTICLE", articleId, message)).rejects.toThrow("already appealed");
    await submitContentAppeal(person, "PROFILE", person.id, message);

    const queue = (await openAppeals(s)).filter((a) => a.person?.id === person.id);
    const articleAppeal = queue.find((a) => a.what.startsWith("Article"))!;
    expect(articleAppeal).toMatchObject({ kind: "CONTENT", link: `/articles/${articleId}`, why: "Looked like a spam account" });
    await decideAppeal(s, articleAppeal.id, true, "It's a genuine article");
    const [a] = await db.select({ hiddenAt: articles.hiddenAt }).from(articles).where(eq(articles.id, articleId));
    expect(a.hiddenAt).toBeNull();

    const profileAppeal = queue.find((x) => x.what.startsWith("Profile"))!;
    await decideAppeal(s, profileAppeal.id, false, "Add a real photo and bio first");
    expect((await myHiddenItems(person)).map((h) => [h.type, h.appeal?.status])).toEqual([["PROFILE", "REJECTED"]]);
    await expect(submitContentAppeal(person, "PROFILE", person.id, message)).rejects.toThrow(/already looked/);
    await expect(submitContentAppeal(person, "ARTICLE", articleId, message)).rejects.toThrow("isn't hidden");

    const log = await platformLog(s);
    expect(log.find((l) => l.action === "APPEAL_REJECTED")).toMatchObject({ targetType: "APPEAL", targetId: profileAppeal.id, reason: "Add a real photo and bio first" });
    expect(await db.select().from(appeals).where(and(eq(appeals.userId, person.id), eq(appeals.status, "ACCEPTED")))).toHaveLength(2);
  });
});
