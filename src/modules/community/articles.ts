import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { articleBookmarks, articleClaps, articleComments, articleReposts, articleReviews, articles, memberProfiles, users } from "@/lib/db/schema";
import { checkFile } from "@/lib/files";
import { readingMinutes } from "@/lib/markdown";
import { storage } from "@/lib/storage";
import { appUrl, sendAccountEmail } from "@/modules/accounts";
import { articleActivityMessage } from "@/modules/email/account";
import { ServiceError } from "@/modules/errors";
import { type Member, canModerate, ensureProfile, fileReport, reportInput } from "./index";

// Phase 37: articles. Members write in a simple Markdown (drafts first, then publish); everyone
// can read published articles, so visitors learn too. Members mark them useful, comment and reply,
// bookmark them, and repost them with a note; Reviewers stamp them "reviewed" with a short note.
// The author gets an email for comments, reviews and reposts.

const PER_DAY = 5;
const COMMENTS_PER_HOUR = 30;
const COVER_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const articleInput = z.object({
  title: z.string().trim().min(5, "Give it a title (at least 5 characters)").max(150),
  summary: z.string().trim().min(10, "One or two sentences on what readers will learn (at least 10 characters)").max(300),
  body: z.string().trim().min(50, "Write a bit more (at least 50 characters)").max(30000, "At most 30,000 characters"),
  tags: z
    .string()
    .max(200)
    .transform((v) => [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))])
    .refine((l) => l.length <= 5, "At most 5 tags")
    .refine((l) => l.every((t) => t.length <= 30), "Each tag at most 30 characters"),
});

async function requireConduct(member: Member) {
  const profile = await ensureProfile(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
  return profile;
}

const validId = (id: string) => z.uuid().safeParse(id).success;

async function ownArticle(member: Member, articleId: string) {
  if (!validId(articleId)) throw new ServiceError("Article not found.");
  const [a] = await db.select().from(articles).where(and(eq(articles.id, articleId), isNull(articles.removedAt)));
  if (!a || a.authorId !== member.id) throw new ServiceError("Only the author can change this article.");
  return a;
}

// --- Writing ---------------------------------------------------------------------------------

/** Saves a new draft. */
export async function createArticle(member: Member, raw: z.input<typeof articleInput>): Promise<string> {
  const input = articleInput.parse(raw);
  await requireConduct(member);
  const [{ n }] = await db
    .select({ n: count() })
    .from(articles)
    .where(and(eq(articles.authorId, member.id), gte(articles.createdAt, new Date(Date.now() - 86_400_000))));
  if (n >= PER_DAY) throw new ServiceError(`You can start ${PER_DAY} articles a day. Try again tomorrow.`);
  const [row] = await db
    .insert(articles)
    .values({ authorId: member.id, ...input, readingMinutes: readingMinutes(input.body) })
    .returning({ id: articles.id });
  return row.id;
}

export async function updateArticle(member: Member, articleId: string, raw: z.input<typeof articleInput>) {
  const input = articleInput.parse(raw);
  await ownArticle(member, articleId);
  await db.update(articles).set({ ...input, readingMinutes: readingMinutes(input.body) }).where(eq(articles.id, articleId));
}

/** Publishes a draft (or takes a published article back to draft). */
export async function setPublished(member: Member, articleId: string, published: boolean) {
  const a = await ownArticle(member, articleId);
  if (published) await requireConduct(member);
  if (published && a.hiddenAt) throw new ServiceError("The organizers hid this article. It can't be published again.");
  await db
    .update(articles)
    .set(published ? { status: "PUBLISHED", publishedAt: a.publishedAt ?? new Date() } : { status: "DRAFT" })
    .where(eq(articles.id, articleId));
}

export async function removeArticle(member: Member, articleId: string) {
  await ownArticle(member, articleId);
  await db.update(articles).set({ removedAt: new Date() }).where(eq(articles.id, articleId));
}

export const coversAvailable = () => storage() !== null;

/** The author: sets the cover picture (or removes it with null). */
export async function setCover(member: Member, articleId: string, file: { name: string; bytes: Uint8Array } | null) {
  await ownArticle(member, articleId);
  if (!file) {
    await db.update(articles).set({ coverKey: null, coverType: null, coverBytes: null }).where(eq(articles.id, articleId));
    return;
  }
  const store = storage();
  if (!store) throw new ServiceError("Picture uploads aren't switched on on this site yet.");
  const checked = checkFile(file.name, file.bytes);
  if ("error" in checked) throw new ServiceError(checked.error);
  if (!COVER_TYPES.includes(checked.contentType)) throw new ServiceError("The cover must be a PNG, JPG, WebP or GIF picture.");
  const sha = createHash("sha256").update(file.bytes).digest("hex");
  const ext = checked.contentType.split("/")[1].replace("jpeg", "jpg");
  const key = await store.put(`community/articles/${sha.slice(0, 2)}/${sha}.${ext}`, file.bytes, checked.contentType);
  await db.update(articles).set({ coverKey: key, coverType: checked.contentType, coverBytes: checked.sizeBytes }).where(eq(articles.id, articleId));
}

// --- Reading ---------------------------------------------------------------------------------

const live = () => and(eq(articles.status, "PUBLISHED"), isNull(articles.removedAt), isNull(articles.hiddenAt));

export type ArticleCard = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  readingMinutes: number;
  hasCover: boolean;
  publishedAt: Date | null;
  author: { name: string; handle: string | null };
  useful: number;
  comments: number;
  reviews: number;
};

const cardColumns = {
  id: articles.id,
  title: articles.title,
  summary: articles.summary,
  tags: articles.tags,
  readingMinutes: articles.readingMinutes,
  coverKey: articles.coverKey,
  publishedAt: articles.publishedAt,
  authorName: users.name,
  authorHandle: memberProfiles.handle,
  useful: sql<number>`(select count(*)::int from article_claps c where c.article_id = ${articles.id})`,
  comments: sql<number>`(select count(*)::int from article_comments c where c.article_id = ${articles.id} and c.removed_at is null and c.hidden_at is null)`,
  reviews: sql<number>`(select count(*)::int from article_reviews r where r.article_id = ${articles.id})`,
};

const cards = () =>
  db
    .select(cardColumns)
    .from(articles)
    .innerJoin(users, eq(users.id, articles.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, articles.authorId));

type CardRow = Awaited<ReturnType<ReturnType<typeof cards>["execute"]>>[number];
const toCard = ({ coverKey, authorName, authorHandle, ...r }: CardRow): ArticleCard => ({ ...r, hasCover: coverKey !== null, author: { name: authorName, handle: authorHandle } });

export type FeedItem = { kind: "article"; at: Date; article: ArticleCard } | { kind: "repost"; at: Date; by: { name: string; handle: string | null }; note: string | null; article: ArticleCard };

/**
 * The feed: "latest" mixes new articles and reposts (newest first); "useful" ranks by useful marks
 * in the last 30 days; "reviewed" shows articles a Reviewer stamped. Filters by tag and words.
 */
export async function articleFeed(filters: { sort?: string; tag?: string; q?: string } = {}): Promise<FeedItem[]> {
  const q = filters.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const tag = filters.tag?.trim().slice(0, 30);
  const where = and(
    live(),
    tag ? sql`lower(${tag}) = ANY (SELECT lower(x) FROM unnest(${articles.tags}) x)` : undefined,
    like ? or(ilike(articles.title, like), ilike(articles.summary, like), sql`array_to_string(${articles.tags}, ' ') ILIKE ${like}`) : undefined,
    filters.sort === "reviewed" ? sql`exists (select 1 from article_reviews r where r.article_id = ${articles.id})` : undefined,
  );
  if (filters.sort === "useful") {
    const rows = await cards()
      .where(where)
      .orderBy(desc(sql`(select count(*) from article_claps c where c.article_id = ${articles.id} and c.created_at > now() - interval '30 days')`), desc(articles.publishedAt))
      .limit(60);
    return rows.map((r) => ({ kind: "article" as const, at: r.publishedAt!, article: toCard(r) }));
  }
  const rows = (await cards().where(where).orderBy(desc(articles.publishedAt)).limit(60)).map(toCard);
  const items: FeedItem[] = rows.map((a) => ({ kind: "article", at: a.publishedAt!, article: a }));
  if (filters.sort !== "reviewed") {
    const reposts = await db
      .select({ articleId: articleReposts.articleId, note: articleReposts.note, at: articleReposts.createdAt, name: users.name, handle: memberProfiles.handle })
      .from(articleReposts)
      .innerJoin(users, eq(users.id, articleReposts.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, articleReposts.userId))
      .orderBy(desc(articleReposts.createdAt))
      .limit(40);
    const ids = [...new Set(reposts.map((r) => r.articleId))];
    const reposted = ids.length ? new Map((await cards().where(and(where, inArray(articles.id, ids)))).map((r) => [r.id, toCard(r)])) : new Map<string, ArticleCard>();
    for (const r of reposts) {
      const article = reposted.get(r.articleId);
      if (article) items.push({ kind: "repost", at: r.at, by: { name: r.name, handle: r.handle }, note: r.note, article });
    }
  }
  // Each article once: its newest appearance (a fresh repost lifts an older article up).
  const seen = new Set<string>();
  return items
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .filter((i) => !seen.has(i.article.id) && !!seen.add(i.article.id))
    .slice(0, 80);
}

/** Popular tags, for the filter. */
export async function articleTags(): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(sql`
    SELECT min(t) AS tag FROM articles a, unnest(a.tags) t
    WHERE a.status = 'PUBLISHED' AND a.removed_at IS NULL AND a.hidden_at IS NULL
    GROUP BY lower(t) ORDER BY count(*) DESC, lower(t) LIMIT 20`);
  return rows.rows.map((r) => r.tag);
}

export type ArticleComment = { id: string; parentId: string | null; authorId: string; authorName: string; authorHandle: string | null; body: string; createdAt: Date; removed: boolean; mine: boolean };

export type ArticleView = ArticleCard & {
  body: string;
  status: "DRAFT" | "PUBLISHED";
  authorId: string;
  hidden: boolean;
  mine: boolean;
  organizer: boolean;
  markedUseful: boolean;
  bookmarked: boolean;
  reposted: boolean;
  reviewedByMe: boolean;
  canReview: boolean;
  reviewsList: { reviewerName: string; reviewerHandle: string | null; note: string; createdAt: Date }[];
  repostsList: { name: string; handle: string | null; note: string | null; createdAt: Date }[];
  commentsList: ArticleComment[];
};

/** One article. Drafts only for the author; hidden ones for the author and organizers. */
export async function getArticle(viewer: Member | null, articleId: string): Promise<ArticleView | null> {
  if (!validId(articleId)) return null;
  const [row] = await db
    .select({ ...cardColumns, body: articles.body, status: articles.status, authorId: articles.authorId, hiddenAt: articles.hiddenAt, removedAt: articles.removedAt })
    .from(articles)
    .innerJoin(users, eq(users.id, articles.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, articles.authorId))
    .where(eq(articles.id, articleId));
  if (!row || row.removedAt) return null;
  const mine = viewer?.id === row.authorId;
  const organizer = viewer ? await canModerate(viewer) : false;
  if (row.status === "DRAFT" && !mine) return null;
  if (row.hiddenAt && !mine && !organizer) return null;
  const [reviewsList, repostsList, comments, flags, me] = await Promise.all([
    db
      .select({ reviewerName: users.name, reviewerHandle: memberProfiles.handle, note: articleReviews.note, createdAt: articleReviews.createdAt, reviewerId: articleReviews.reviewerId })
      .from(articleReviews)
      .innerJoin(users, eq(users.id, articleReviews.reviewerId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, articleReviews.reviewerId))
      .where(eq(articleReviews.articleId, articleId))
      .orderBy(articleReviews.createdAt),
    db
      .select({ name: users.name, handle: memberProfiles.handle, note: articleReposts.note, createdAt: articleReposts.createdAt, userId: articleReposts.userId })
      .from(articleReposts)
      .innerJoin(users, eq(users.id, articleReposts.userId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, articleReposts.userId))
      .where(eq(articleReposts.articleId, articleId))
      .orderBy(desc(articleReposts.createdAt))
      .limit(50),
    db
      .select({ c: articleComments, authorName: users.name, authorHandle: memberProfiles.handle })
      .from(articleComments)
      .innerJoin(users, eq(users.id, articleComments.authorId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, articleComments.authorId))
      .where(eq(articleComments.articleId, articleId))
      .orderBy(articleComments.createdAt)
      .limit(500),
    viewer
      ? db.execute<{ useful: boolean; bookmarked: boolean }>(sql`
          select exists (select 1 from article_claps where article_id = ${articleId} and user_id = ${viewer.id}) as useful,
                 exists (select 1 from article_bookmarks where article_id = ${articleId} and user_id = ${viewer.id}) as bookmarked`)
      : Promise.resolve(null),
    viewer ? db.select({ reviewer: memberProfiles.reviewer }).from(memberProfiles).where(eq(memberProfiles.userId, viewer.id)) : Promise.resolve([]),
  ]);
  const { hiddenAt, removedAt: _removed, coverKey, authorName, authorHandle, ...rest } = row;
  void _removed;
  return {
    ...rest,
    status: row.status as ArticleView["status"],
    hasCover: coverKey !== null,
    author: { name: authorName, handle: authorHandle },
    hidden: hiddenAt !== null,
    mine,
    organizer,
    markedUseful: flags?.rows[0]?.useful ?? false,
    bookmarked: flags?.rows[0]?.bookmarked ?? false,
    reposted: !!viewer && repostsList.some((r) => r.userId === viewer.id),
    reviewedByMe: !!viewer && reviewsList.some((r) => r.reviewerId === viewer.id),
    canReview: !!viewer && !mine && row.status === "PUBLISHED" && !!me[0]?.reviewer,
    reviewsList: reviewsList.map(({ reviewerId: _r, ...r }) => (void _r, r)),
    repostsList: repostsList.map(({ userId: _u, ...r }) => (void _u, r)),
    commentsList: comments.map(({ c, authorName: n, authorHandle: h }) => {
      const gone = !!c.removedAt || (!!c.hiddenAt && !organizer);
      return {
        id: c.id,
        parentId: c.parentId,
        authorId: c.authorId,
        authorName: n,
        authorHandle: h,
        body: c.removedAt ? "This comment was deleted." : c.hiddenAt && !organizer ? "This comment was hidden by the organizers." : c.body,
        createdAt: c.createdAt,
        removed: gone,
        mine: c.authorId === viewer?.id,
      };
    }),
  };
}

/** For the cover route: published, not hidden. */
export async function openCover(articleId: string) {
  if (!validId(articleId)) return null;
  const [a] = await db.select().from(articles).where(and(eq(articles.id, articleId), live(), isNotNull(articles.coverKey)));
  const store = storage();
  if (!a?.coverKey || !store) return null;
  const file = await store.get(a.coverKey);
  return file ? { type: a.coverType!, bytes: a.coverBytes!, body: file.body } : null;
}

export type MyArticles = { written: (ArticleCard & { status: string; hidden: boolean })[]; bookmarks: ArticleCard[] };

/** My drafts and published articles, and what I bookmarked. */
export async function myArticles(member: Member): Promise<MyArticles> {
  const written = await db
    .select({ ...cardColumns, status: articles.status, hiddenAt: articles.hiddenAt })
    .from(articles)
    .innerJoin(users, eq(users.id, articles.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, articles.authorId))
    .where(and(eq(articles.authorId, member.id), isNull(articles.removedAt)))
    .orderBy(desc(articles.updatedAt))
    .limit(100);
  const marked = await db
    .select({ id: articleBookmarks.articleId })
    .from(articleBookmarks)
    .where(eq(articleBookmarks.userId, member.id))
    .orderBy(desc(articleBookmarks.createdAt))
    .limit(100);
  const bookmarkRows = marked.length ? await cards().where(and(live(), inArray(articles.id, marked.map((m) => m.id)))) : [];
  const order = new Map(marked.map((m, i) => [m.id, i]));
  return {
    written: written.map(({ status, hiddenAt, ...r }) => ({ ...toCard(r), status, hidden: hiddenAt !== null })),
    bookmarks: bookmarkRows.map(toCard).sort((a, b) => order.get(a.id)! - order.get(b.id)!),
  };
}

/** A member's published articles and reposts, for their profile. */
export async function articlesBy(userId: string): Promise<{ written: ArticleCard[]; reposted: (ArticleCard & { note: string | null })[] }> {
  const written = (await cards().where(and(live(), eq(articles.authorId, userId))).orderBy(desc(articles.publishedAt)).limit(20)).map(toCard);
  const reposts = await db.select({ id: articleReposts.articleId, note: articleReposts.note }).from(articleReposts).where(eq(articleReposts.userId, userId)).orderBy(desc(articleReposts.createdAt)).limit(20);
  const rows = reposts.length ? new Map((await cards().where(and(live(), inArray(articles.id, reposts.map((r) => r.id))))).map((r) => [r.id, toCard(r)])) : new Map<string, ArticleCard>();
  return { written, reposted: reposts.flatMap((r) => (rows.has(r.id) ? [{ ...rows.get(r.id)!, note: r.note }] : [])) };
}

// --- Taking part -----------------------------------------------------------------------------

async function liveArticle(articleId: string) {
  if (!validId(articleId)) throw new ServiceError("Article not found.");
  const [a] = await db
    .select({ id: articles.id, authorId: articles.authorId, title: articles.title, email: users.email, name: users.name })
    .from(articles)
    .innerJoin(users, eq(users.id, articles.authorId))
    .where(and(eq(articles.id, articleId), live()));
  if (!a) throw new ServiceError("Article not found.");
  return a;
}

async function tellAuthor(a: { id: string; authorId: string; title: string; email: string; name: string }, actor: Member, what: string, quote: string | null) {
  if (a.authorId === actor.id) return;
  await sendAccountEmail(a.email, articleActivityMessage({ name: a.name, from: actor.name, title: a.title, what, quote, url: appUrl(`/articles/${a.id}`) })).catch((error) =>
    console.error("Article email failed", a.id, error instanceof Error ? error.message : error),
  );
}

/** Marks it useful, or takes the mark back. Not your own. */
export async function toggleUseful(member: Member, articleId: string): Promise<boolean> {
  await requireConduct(member);
  const a = await liveArticle(articleId);
  if (a.authorId === member.id) throw new ServiceError("You can't mark your own article.");
  const removed = await db.delete(articleClaps).where(and(eq(articleClaps.articleId, articleId), eq(articleClaps.userId, member.id))).returning({ id: articleClaps.articleId });
  if (removed.length > 0) return false;
  await db.insert(articleClaps).values({ articleId, userId: member.id }).onConflictDoNothing();
  return true;
}

export async function toggleBookmark(member: Member, articleId: string): Promise<boolean> {
  await liveArticle(articleId);
  const removed = await db.delete(articleBookmarks).where(and(eq(articleBookmarks.articleId, articleId), eq(articleBookmarks.userId, member.id))).returning({ id: articleBookmarks.articleId });
  if (removed.length > 0) return false;
  await db.insert(articleBookmarks).values({ articleId, userId: member.id }).onConflictDoNothing();
  return true;
}

export const commentInput = z.object({ body: z.string().trim().min(2, "Write a comment").max(2000, "At most 2,000 characters") });

/** Comments on an article, or replies to a comment (one level: replies to a reply join its thread). */
export async function addComment(member: Member, articleId: string, raw: z.input<typeof commentInput>, parentId?: string | null): Promise<string> {
  const { body } = commentInput.parse(raw);
  await requireConduct(member);
  const a = await liveArticle(articleId);
  const [{ n }] = await db
    .select({ n: count() })
    .from(articleComments)
    .where(and(eq(articleComments.authorId, member.id), gte(articleComments.createdAt, new Date(Date.now() - 3_600_000))));
  if (n >= COMMENTS_PER_HOUR) throw new ServiceError("You're commenting very fast. Try again a bit later.");
  let parent: typeof articleComments.$inferSelect | undefined;
  if (parentId) {
    if (!validId(parentId)) throw new ServiceError("Comment not found.");
    [parent] = await db.select().from(articleComments).where(and(eq(articleComments.id, parentId), eq(articleComments.articleId, articleId)));
    if (!parent || parent.removedAt || parent.hiddenAt) throw new ServiceError("That comment isn't there any more.");
  }
  const [row] = await db
    .insert(articleComments)
    .values({ articleId, authorId: member.id, body, parentId: parent ? (parent.parentId ?? parent.id) : null })
    .returning({ id: articleComments.id });
  await tellAuthor(a, member, "commented on", body);
  if (parent && parent.authorId !== member.id && parent.authorId !== a.authorId) {
    const [p] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, parent.authorId));
    if (p) {
      await sendAccountEmail(p.email, articleActivityMessage({ name: p.name, from: member.name, title: a.title, what: "replied to your comment on", quote: body, url: appUrl(`/articles/${a.id}#comments`) })).catch(
        (error) => console.error("Article reply email failed", a.id, error instanceof Error ? error.message : error),
      );
    }
  }
  return row.id;
}

export async function deleteComment(member: Member, commentId: string) {
  if (!validId(commentId)) throw new ServiceError("Comment not found.");
  const [updated] = await db
    .update(articleComments)
    .set({ removedAt: new Date() })
    .where(and(eq(articleComments.id, commentId), eq(articleComments.authorId, member.id), isNull(articleComments.removedAt)))
    .returning({ id: articleComments.id });
  if (!updated) throw new ServiceError("You can only delete your own comments.");
}

export const reviewInput = z.object({ note: z.string().trim().min(10, "Say what you checked (at least 10 characters)").max(500) });

/** Reviewers: stamp an article reviewed, with a short note. Not your own; once each. */
export async function reviewArticle(member: Member, articleId: string, raw: z.input<typeof reviewInput>) {
  const { note } = reviewInput.parse(raw);
  const profile = await requireConduct(member);
  if (!profile.reviewer) throw new ServiceError("Only members with the Reviewer badge can review articles.");
  const a = await liveArticle(articleId);
  if (a.authorId === member.id) throw new ServiceError("You can't review your own article.");
  const inserted = await db.insert(articleReviews).values({ articleId, reviewerId: member.id, note }).onConflictDoNothing().returning({ id: articleReviews.articleId });
  if (inserted.length === 0) throw new ServiceError("You already reviewed this article.");
  await tellAuthor(a, member, "reviewed", note);
}

export const repostInput = z.object({
  note: z
    .string()
    .trim()
    .max(280, "At most 280 characters")
    .transform((v) => v || null),
});

/** Shares an article to your profile and the feed, with an optional note (again to take it back). */
export async function toggleRepost(member: Member, articleId: string, raw: z.input<typeof repostInput>): Promise<boolean> {
  const { note } = repostInput.parse(raw);
  await requireConduct(member);
  const a = await liveArticle(articleId);
  if (a.authorId === member.id) throw new ServiceError("You can't repost your own article.");
  const removed = await db.delete(articleReposts).where(and(eq(articleReposts.articleId, articleId), eq(articleReposts.userId, member.id))).returning({ id: articleReposts.id });
  if (removed.length > 0) return false;
  await db.insert(articleReposts).values({ articleId, userId: member.id, note }).onConflictDoNothing();
  await tellAuthor(a, member, "reposted", note);
  return true;
}

// --- Moderation ------------------------------------------------------------------------------

export async function reportArticle(member: Member, articleId: string, raw: z.input<typeof reportInput>) {
  const a = await liveArticle(articleId);
  if (a.authorId === member.id) throw new ServiceError("You can't report your own article.");
  await fileReport(member, "ARTICLE", articleId, raw);
}

export async function reportComment(member: Member, commentId: string, raw: z.input<typeof reportInput>) {
  if (!validId(commentId)) throw new ServiceError("Comment not found.");
  const [c] = await db.select().from(articleComments).where(eq(articleComments.id, commentId));
  if (!c || c.removedAt) throw new ServiceError("Comment not found.");
  if (c.authorId === member.id) throw new ServiceError("You can't report your own comment.");
  await fileReport(member, "ARTICLE_COMMENT", commentId, raw);
}

/** Organizers: shows a hidden article or comment again. */
export async function unhideArticle(member: Member, articleId: string) {
  if (!(await canModerate(member))) throw new ServiceError("Only community organizers can do that.");
  await db.update(articles).set({ hiddenAt: null, hiddenBy: null, hiddenReason: null }).where(eq(articles.id, articleId));
}
