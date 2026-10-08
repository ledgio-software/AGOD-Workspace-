import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { articles, memberProfiles, users } from "@/lib/db/schema";
import { type Member, acceptConduct, ensureProfile, listReports, resolveReport } from "@/modules/community";
import {
  addComment,
  articleFeed,
  articleTags,
  articlesBy,
  createArticle,
  deleteComment,
  getArticle,
  myArticles,
  removeArticle,
  reportArticle,
  reportComment,
  reviewArticle,
  setPublished,
  toggleBookmark,
  toggleRepost,
  toggleUseful,
  unhideArticle,
  updateArticle,
} from "@/modules/community/articles";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 37: articles.

async function member(name: string, conduct = true): Promise<Member & { handle: string }> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  const p = await ensureProfile(m);
  if (conduct) await acceptConduct(m);
  return { ...m, handle: p.handle };
}

const tag = `t${randomUUID().slice(0, 8)}`;
const draft = (title: string, tags = tag) => ({
  title,
  summary: "What I learned adding payments to my app.",
  body: "## Step one\n\nFirst, **never** put your secret key in the browser. Keep it on the server and call the API from there.",
  tags,
});

describe("articles", () => {
  it("drafts are private until published; then everyone reads them on the feed", async () => {
    const ama = await member("Ama Writer");
    const kofi = await member("Kofi Reader");
    const newcomer = await member("New Writer", false);
    await expect(createArticle(newcomer, draft("My first article"))).rejects.toThrow(/code of conduct/);
    await expect(createArticle(ama, { ...draft("Too many tags"), tags: "a, b, c, d, e, f" })).rejects.toThrow(/At most 5 tags/);

    const id = await createArticle(ama, draft("Adding MoMo payments safely"));
    expect(await getArticle(kofi, id)).toBeNull();
    expect(await getArticle(null, id)).toBeNull();
    expect((await getArticle(ama, id))!.status).toBe("DRAFT");
    expect((await articleFeed({ tag })).map((i) => i.article.id)).not.toContain(id);
    await expect(updateArticle(kofi, id, draft("Not mine"))).rejects.toThrow(/Only the author/);

    await setPublished(ama, id, true);
    const view = (await getArticle(null, id))!;
    expect(view).toMatchObject({ title: "Adding MoMo payments safely", status: "PUBLISHED", readingMinutes: 1, mine: false, tags: [tag] });
    expect((await articleFeed({ tag: tag.toUpperCase() })).map((i) => i.article.id)).toEqual([id]);
    expect((await articleFeed({ q: "momo payments" })).map((i) => i.article.id)).toContain(id);
    expect(await articleTags()).toContain(tag);

    // Back to draft takes it off the feed; publishing again keeps the first date.
    const first = view.publishedAt;
    await setPublished(ama, id, false);
    expect(await getArticle(kofi, id)).toBeNull();
    await setPublished(ama, id, true);
    expect((await getArticle(kofi, id))!.publishedAt).toEqual(first);

    expect((await myArticles(ama)).written.map((a) => a.id)).toContain(id);
    expect((await articlesBy(ama.id)).written.map((a) => a.id)).toEqual([id]);
    await removeArticle(ama, id);
    expect(await getArticle(ama, id)).toBeNull();
  });

  it("useful marks, bookmarks, comments with replies, reviews and reposts", async () => {
    const author = await member("Author Person");
    const reader = await member("Reader Person");
    const other = await member("Other Person");
    const reviewer = await member("Reviewer Person");
    await db.update(memberProfiles).set({ reviewer: true }).where(eq(memberProfiles.userId, reviewer.id));
    const id = await createArticle(author, draft("Ship your first Lovable app"));
    await expect(toggleUseful(reader, id)).rejects.toThrow(/not found/);
    await setPublished(author, id, true);

    await expect(toggleUseful(author, id)).rejects.toThrow(/your own/);
    expect(await toggleUseful(reader, id)).toBe(true);
    expect((await getArticle(reader, id))!).toMatchObject({ useful: 1, markedUseful: true });
    expect(await toggleUseful(reader, id)).toBe(false);
    expect((await getArticle(reader, id))!.useful).toBe(0);
    await toggleUseful(other, id);

    expect(await toggleBookmark(reader, id)).toBe(true);
    expect((await myArticles(reader)).bookmarks.map((a) => a.id)).toEqual([id]);

    // A reply to a reply joins the first comment's thread.
    const c1 = await addComment(reader, id, { body: "Did you need a paid plan for this?" });
    const r1 = await addComment(author, id, { body: "No, the free plan was enough." }, c1);
    const r2 = await addComment(other, id, { body: "Same for me." }, r1);
    const view = (await getArticle(other, id))!;
    expect(view.commentsList.map((c) => [c.id, c.parentId])).toEqual([
      [c1, null],
      [r1, c1],
      [r2, c1],
    ]);
    expect(view.comments).toBe(3);
    await expect(deleteComment(reader, r2)).rejects.toThrow(/your own/);
    await deleteComment(other, r2);
    expect((await getArticle(null, id))!.commentsList.find((c) => c.id === r2)).toMatchObject({ removed: true, body: "This comment was deleted." });
    await expect(addComment(reader, id, { body: "reply" }, r2)).rejects.toThrow(/isn't there/);

    await expect(reviewArticle(reader, id, { note: "I followed every step and it worked." })).rejects.toThrow(/Reviewer badge/);
    expect((await getArticle(reviewer, id))!.canReview).toBe(true);
    await reviewArticle(reviewer, id, { note: "I followed every step and it worked." });
    await expect(reviewArticle(reviewer, id, { note: "Again, it still works fine." })).rejects.toThrow(/already reviewed/);
    expect((await getArticle(null, id))!.reviewsList).toMatchObject([{ reviewerName: "Reviewer Person", note: "I followed every step and it worked." }]);
    expect((await articleFeed({ sort: "reviewed", tag })).map((i) => i.article.id)).toContain(id);

    await expect(toggleRepost(author, id, { note: "" })).rejects.toThrow(/your own/);
    expect(await toggleRepost(reader, id, { note: "Read this before adding payments." })).toBe(true);
    const feed = await articleFeed({ tag });
    expect(feed.find((i) => i.kind === "repost" && i.article.id === id)).toMatchObject({ by: { name: "Reader Person" }, note: "Read this before adding payments." });
    expect(feed.filter((i) => i.article.id === id)).toHaveLength(1); // once, as its newest appearance
    expect((await articlesBy(reader.id)).reposted).toMatchObject([{ id, note: "Read this before adding payments." }]);
    expect((await getArticle(reader, id))!.reposted).toBe(true);
    expect(await toggleRepost(reader, id, { note: "" })).toBe(false);
    expect((await articlesBy(reader.id)).reposted).toEqual([]);

    // "Most useful" ranks by marks in the last 30 days.
    const quiet = await createArticle(author, draft("A quieter article"));
    await setPublished(author, quiet, true);
    const useful = (await articleFeed({ sort: "useful", tag })).map((i) => i.article.id);
    expect(useful.indexOf(id)).toBeLessThan(useful.indexOf(quiet));
  });

  it("reports go to the organizers, who can hide articles and comments", async () => {
    const author = await member("Spam Author");
    const reader = await member("Careful Reader");
    const org = await member("Organizer Articles");
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    const id = await createArticle(author, draft("Buy followers cheap"));
    await setPublished(author, id, true);
    const c = await addComment(author, id, { body: "Message me for a deal" });

    await expect(reportArticle(author, id, { reason: "Reporting my own article" })).rejects.toThrow(/your own/);
    await reportArticle(reader, id, { reason: "This is an advert, not an article" });
    await reportComment(reader, c, { reason: "Spam in the comments here" });
    const reports = await listReports(org);
    const ra = reports.find((r) => r.target_type === "ARTICLE" && r.target_link === `/articles/${id}`)!;
    const rc = reports.find((r) => r.target_type === "ARTICLE_COMMENT" && r.target_link === `/articles/${id}#comments`)!;
    expect(ra.target_name).toBe("Buy followers cheap");
    expect(rc.target_name).toBe("Comment by Spam Author on Buy followers cheap");

    await resolveReport(org, rc.id, { action: "HIDE", note: "Spam" });
    expect((await getArticle(reader, id))!.commentsList[0]).toMatchObject({ removed: true, body: "This comment was hidden by the organizers." });
    await resolveReport(org, ra.id, { action: "HIDE", note: "Advert" });
    expect(await getArticle(reader, id)).toBeNull();
    expect((await getArticle(author, id))!.hidden).toBe(true);
    expect((await getArticle(org, id))!.hidden).toBe(true);
    expect((await articleFeed({ tag })).map((i) => i.article.id)).not.toContain(id);
    await expect(setPublished(author, id, true)).rejects.toThrow(/hid this article/);

    await unhideArticle(org, id);
    expect(await getArticle(reader, id)).not.toBeNull();
    const [row] = await db.select({ hiddenAt: articles.hiddenAt }).from(articles).where(eq(articles.id, id));
    expect(row.hiddenAt).toBeNull();
  });
});
