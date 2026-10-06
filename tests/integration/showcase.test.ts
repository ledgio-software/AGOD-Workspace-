import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withActor } from "@/lib/db/actor";
import { showcaseImages, showcasePosts, showcaseReviews, users } from "@/lib/db/schema";
import { type Member, acceptConduct, ensureProfile, listReports, resolveReport } from "@/modules/community";
import {
  addReview,
  addScreenshot,
  createPost,
  getPost,
  giveBack,
  listPosts,
  openScreenshot,
  removePost,
  removeScreenshot,
  replyToReview,
  reportPost,
  reportReview,
  reviewRequests,
  setPostStatus,
  unhideShowcase,
  updatePost,
  videoHost,
} from "@/modules/community/showcase";
import { createUser, db, expectDbError } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 26: the showcase (projects, screenshots, video links) and reviews.

let outbox = "";
beforeEach(() => {
  outbox = mkdtempSync(path.join(tmpdir(), "agod-outbox-"));
  vi.stubEnv("EMAIL_OUTBOX_DIR", outbox);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("LOCAL_UPLOAD_DIR", mkdtempSync(path.join(tmpdir(), "agod-uploads-")));
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

const tag = () => `tag${randomUUID().slice(0, 8)}`;
const post = (extra: Record<string, unknown> = {}) => ({
  title: "Market Mama",
  pitch: "Helps market women track MoMo sales.",
  audience: "",
  builtWith: "Lovable, Supabase",
  aiBuilt: true,
  liveUrl: "marketmama.app",
  repoUrl: "",
  videoUrl: "https://www.loom.com/share/abc",
  feedbackAreas: ["SECURITY", "UX", "NOPE"],
  feedbackWanted: "Is the login safe?",
  stuckOn: "",
  needs: ["TESTERS"],
  visibility: "PUBLIC" as const,
  safety: true as const,
  ...extra,
});
// A different picture each time (identical ones are stored once and refused twice on a project).
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(randomUUID())]);

async function organizer() {
  const o = await member("Organizer");
  vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", o.email);
  return o;
}

describe("sharing projects", () => {
  it("follows the template, checks links and the safety checklist, and needs the code of conduct", async () => {
    const newcomer = await member("Newcomer", false);
    await expect(createPost(newcomer, post())).rejects.toThrow(/code of conduct/);
    const m = await member();
    await expect(createPost(m, post({ safety: false }))).rejects.toThrow(/safety checklist/);
    await expect(createPost(m, post({ pitch: "Short" }))).rejects.toThrow(/one sentence/);
    await expect(createPost(m, post({ videoUrl: "not a link" }))).rejects.toThrow(/web address/);
    const created = await createPost(m, post());
    expect(created).toMatchObject({
      liveUrl: "https://marketmama.app",
      repoUrl: null,
      builtWith: ["Lovable", "Supabase"],
      feedbackAreas: ["SECURITY", "UX"],
      needs: ["TESTERS"],
      status: "NEEDS_REVIEW",
      aiBuilt: true,
    });
    expect(created.safetyConfirmedAt).toBeInstanceOf(Date);
    expect(videoHost(created.videoUrl!)).toBe("Loom");
    expect(videoHost("https://youtu.be/x")).toBe("YouTube");

    const other = await member("Other");
    await expect(updatePost(other, created.id, post({ title: "Taken over" }))).rejects.toThrow(/not found/);
    const updated = await updatePost(m, created.id, post({ title: "Market Mama 2" }));
    expect(updated.title).toBe("Market Mama 2");
    await expect(setPostStatus(other, created.id, "SHIPPED")).rejects.toThrow(/not found/);
    await setPostStatus(m, created.id, "SHIPPED");
    expect((await getPost(created.id, null))!.post.status).toBe("SHIPPED");
  });

  it("allows five projects a day", async () => {
    const m = await member();
    for (let i = 0; i < 5; i++) await createPost(m, post({ title: `Project ${i}` }));
    await expect(createPost(m, post())).rejects.toThrow(/5 projects today/);
  });

  it("shows visitors public projects only; members see members-only ones; removed ones are gone", async () => {
    const t = tag();
    const m = await member("Author");
    const pub = await createPost(m, post({ title: "Public one", builtWith: t }));
    const priv = await createPost(m, post({ title: "Private one", builtWith: t, visibility: "MEMBERS" }));
    const gone = await createPost(m, post({ title: "Gone one", builtWith: t }));
    await removePost(m, gone.id);
    const viewer = await member("Viewer");
    const titles = async (v: Member | null, f = {}) => (await listPosts(v, { q: t, ...f })).posts.map((p) => p.title).sort();
    expect(await titles(null)).toEqual(["Public one"]);
    expect(await titles(viewer)).toEqual(["Private one", "Public one"]);
    expect(await titles(viewer, { status: "SHIPPED" })).toEqual([]);
    expect(await getPost(priv.id, null)).toBeNull();
    expect(await getPost(gone.id, m)).toBeNull();
    expect((await getPost(pub.id, viewer))!.self).toBe(false);
    expect((await getPost(pub.id, m))!.self).toBe(true);
    expect(await getPost("not-a-uuid", viewer)).toBeNull();
  });
});

describe("screenshots", () => {
  it("are images only, four at most, and served to whoever may see the project", async () => {
    const m = await member();
    const p = await createPost(m, post({ visibility: "MEMBERS" }));
    const viewer = await member("Viewer");
    await expect(addScreenshot(viewer, p.id, { name: "x.png", bytes: png() })).rejects.toThrow(/not found/);
    await expect(addScreenshot(m, p.id, { name: "doc.pdf", bytes: new TextEncoder().encode("%PDF-1.4 hello") })).rejects.toThrow(/PNG, JPG/);
    await expect(addScreenshot(m, p.id, { name: "fake.png", bytes: new TextEncoder().encode("not an image") })).rejects.toThrow(/does not match/);
    const first = await addScreenshot(m, p.id, { name: "home.png", bytes: png() });
    for (let i = 0; i < 3; i++) await addScreenshot(m, p.id, { name: `s${i}.png`, bytes: png() });
    await expect(addScreenshot(m, p.id, { name: "five.png", bytes: png() })).rejects.toThrow(/4 screenshots/);

    expect(await openScreenshot(p.id, first.id, null)).toBeNull();
    const opened = await openScreenshot(p.id, first.id, viewer);
    expect(opened?.image.contentType).toBe("image/png");
    expect(Buffer.from(opened!.body as Uint8Array).subarray(0, 4).toString("hex")).toBe("89504e47");
    // The id must belong to that project.
    const otherPost = await createPost(m, post());
    expect(await openScreenshot(otherPost.id, first.id, viewer)).toBeNull();

    await expect(removeScreenshot(viewer, first.id)).rejects.toThrow(/not found/);
    await removeScreenshot(m, first.id);
    expect(await openScreenshot(p.id, first.id, viewer)).toBeNull();
    expect((await getPost(p.id, viewer))!.images).toHaveLength(3);
    const card = (await listPosts(viewer, { authorId: m.id })).posts.find((c) => c.id === p.id)!;
    expect(card.coverId).toBe((await getPost(p.id, viewer))!.images[0]);
  });
});

describe("reviews", () => {
  it("come from others, once, move the request to Reviewed, and email the author", async () => {
    const author = await member("Akosua Author");
    const reviewer = await member("Kojo Reviewer");
    const p = await createPost(author, post({ title: "Farm Ledger" }));
    const review = { whatWorks: "The sign-up flow is quick and clear.", toImprove: "", nextStep: "Move the API key to an environment variable." };
    await expect(addReview(author, p.id, review)).rejects.toThrow(/your own project/);
    await expect(addReview(reviewer, p.id, { ...review, nextStep: "Fix it" })).rejects.toThrow(/next step/);
    await expect(addReview(await member("New", false), p.id, review)).rejects.toThrow(/code of conduct/);
    expect((await listPosts(reviewer, { status: "NEEDS_REVIEW", authorId: author.id })).posts.map((x) => x.id)).toEqual([p.id]);
    // Never one's own projects.
    expect((await reviewRequests(author, 50)).map((x) => x.id)).not.toContain(p.id);

    const r = await addReview(reviewer, p.id, review);
    expect(r.toImprove).toBeNull();
    await expect(addReview(reviewer, p.id, review)).rejects.toThrow(/already reviewed/);
    expect((await getPost(p.id, null))!.post.status).toBe("REVIEWED");
    const mail = mails().find((x) => x.to === author.email)!;
    expect(mail.subject).toBe("New feedback on Farm Ledger");
    expect(mail.text).toContain(`http://localhost:3000/showcase/${p.id}#reviews`);
    expect(await reviewRequests(reviewer, 50)).not.toContainEqual(expect.objectContaining({ id: p.id }));
    expect(await giveBack(reviewer.id)).toEqual({ posts: 0, reviews: 1 });
    expect(await giveBack(author.id)).toEqual({ posts: 1, reviews: 0 });

    // Only the author replies, once.
    await expect(replyToReview(reviewer, r.id, { reply: "Thanks me" })).rejects.toThrow(/not found/);
    await replyToReview(author, r.id, { reply: "Thank you, fixed!" });
    await expect(replyToReview(author, r.id, { reply: "Again" })).rejects.toThrow(/already replied/);
    const page = (await getPost(p.id, reviewer))!;
    expect(page.reviewed).toBe(true);
    expect(page.reviews[0]).toMatchObject({ reviewerName: "Kojo Reviewer", authorReply: "Thank you, fixed!" });
  });
});

describe("reports", () => {
  it("organizers hide reported projects and feedback, and can show them again", async () => {
    const org = await organizer();
    const author = await member("Spammer");
    const reader = await member("Reader");
    const p = await createPost(author, post({ title: "Get rich quick" }));
    const reviewer = await member("Rude Reviewer");
    const r = await addReview(reviewer, p.id, { whatWorks: "Nothing works at all here.", toImprove: "", nextStep: "Give up and do something else." });

    await expect(reportPost(author, p.id, { reason: "Reporting my own post" })).rejects.toThrow(/your own/);
    const postReport = await reportPost(reader, p.id, { reason: "Looks like a pyramid scheme" });
    const reviewReport = await reportReview(author, r.id, { reason: "This feedback attacks me, not the work" });
    const listed = await listReports(org);
    expect(listed.find((x) => x.id === postReport.id)).toMatchObject({ target_type: "POST", target_name: "Get rich quick", target_link: `/showcase/${p.id}` });
    expect(listed.find((x) => x.id === reviewReport.id)).toMatchObject({ target_type: "REVIEW", target_name: "Feedback by Rude Reviewer on Get rich quick" });

    await resolveReport(org, postReport.id, { action: "HIDE", note: "Scam" });
    expect(await getPost(p.id, reader)).toBeNull();
    expect((await listPosts(null, { authorId: author.id })).posts).toHaveLength(0);
    expect((await getPost(p.id, author))!.post.hiddenReason).toBe("Scam");
    expect(await getPost(p.id, org)).not.toBeNull();

    await resolveReport(org, reviewReport.id, { action: "HIDE", note: "Not kind" });
    await unhideShowcase(org, "POST", p.id);
    const seen = (await getPost(p.id, reader))!;
    expect(seen.reviews).toHaveLength(0);
    expect((await getPost(p.id, org))!.reviews[0]).toMatchObject({ hidden: true, hiddenReason: "Not kind" });
    expect((await getPost(p.id, reviewer))!.reviews[0].hidden).toBe(true);
    await expect(unhideShowcase(reader, "REVIEW", r.id)).rejects.toThrow(/organizers/);

    // An organizer can't settle a report about their own project.
    const own = await createPost(org, post({ title: "Organizer's app" }));
    const ownReport = await reportPost(reader, own.id, { reason: "Testing the organizer rule" });
    await expect(resolveReport(org, ownReport.id, { action: "HIDE", note: "Nope" })).rejects.toThrow(/another organizer/);
  });

  it("keeps showcase tables away from the app role", async () => {
    const actor = await createUser("ADMIN");
    for (const table of [showcasePosts, showcaseImages, showcaseReviews]) {
      await expectDbError(withActor(actor, (tx) => tx.select().from(table)), /permission denied/);
    }
    // The database refuses what the forms would.
    const p = await createPost(await member(), post());
    await expect(db.update(showcasePosts).set({ status: "DONE" }).where(eq(showcasePosts.id, p.id))).rejects.toThrow();
    await expect(db.update(showcasePosts).set({ liveUrl: "javascript:alert(1)" }).where(eq(showcasePosts.id, p.id))).rejects.toThrow();
    await expect(db.update(showcasePosts).set({ feedbackAreas: ["MONEY"] }).where(eq(showcasePosts.id, p.id))).rejects.toThrow();
  });
});
