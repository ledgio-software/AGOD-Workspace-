import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { memberProfiles, showcaseImages, showcasePosts, showcaseReviewReplies, showcaseReviews, users } from "@/lib/db/schema";
import { checkFile } from "@/lib/files";
import { storage } from "@/lib/storage";
import { appUrl, sendAccountEmail } from "@/modules/accounts";
import { newReviewMessage, reviewReplyMessage } from "@/modules/email/account";
import { ServiceError } from "@/modules/errors";
import { FEEDBACK_AREAS, NEEDS, type PostStatus, STATUS_LABEL } from "./showcase-labels";
import { type Member, ensureProfile, fileReport, isOrganizer, reportInput } from "./index";

// Phase 26: the showcase. Members share projects (the handbook's posting template) with
// screenshots and a video demo link, ask for specific feedback, and review each other's work
// (what works, what to improve, one next step). Posts are public unless the author limits them to
// signed-in members; organizers can hide posts and reviews after a report.

export const MAX_IMAGES = 4;
const POSTS_PER_DAY = 5;

const link = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : /^https?:\/\//i.test(v) ? v.replace(/^http:\/\//i, "https://") : `https://${v}`))
  .refine((v) => v === null || /^https:\/\/[^\s/]+\.[^\s]+$/.test(v), "Enter a web address such as https://myapp.com");

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}: at most ${max} characters`)
    .transform((v) => v || null);

const list = <T extends string>(allowed: readonly T[]) => z.array(z.string()).transform((v) => [...new Set(v)].filter((x): x is T => (allowed as readonly string[]).includes(x)));

export const postInput = z.object({
  title: z.string().trim().min(2, "Give the project a name").max(120),
  pitch: z.string().trim().min(10, "Say what it does in one sentence (at least 10 characters)").max(200, "What it does: one sentence (at most 200 characters)"),
  audience: optionalText(200, "Who it is for"),
  builtWith: z
    .string()
    .max(600)
    .transform((v) => [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))])
    .refine((l) => l.length <= 15, "Built with: at most 15 tools")
    .refine((l) => l.every((t) => t.length <= 30), "Built with: each tool at most 30 characters"),
  aiBuilt: z.boolean(),
  liveUrl: link,
  repoUrl: link,
  videoUrl: link,
  feedbackAreas: list(Object.keys(FEEDBACK_AREAS) as (keyof typeof FEEDBACK_AREAS)[]),
  feedbackWanted: optionalText(1000, "What you want feedback on"),
  stuckOn: optionalText(1000, "What you are stuck on"),
  needs: list(Object.keys(NEEDS) as (keyof typeof NEEDS)[]),
  visibility: z.enum(["PUBLIC", "MEMBERS"]),
  safety: z.literal(true, { error: "Confirm the safety checklist before posting" }),
});

async function requireConduct(member: Member) {
  const profile = await ensureProfile(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
  return profile;
}

async function viewerIsOrganizer(viewer: Member | null) {
  if (!viewer) return false;
  const [p] = await db.select({ communityRole: memberProfiles.communityRole }).from(memberProfiles).where(eq(memberProfiles.userId, viewer.id));
  return isOrganizer(p ?? null, viewer.email);
}

const fields = (input: z.output<typeof postInput>) => {
  const { safety, ...rest } = input;
  void safety;
  return rest;
};

/** Any member who agreed to the code of conduct: shares a project. */
export async function createPost(member: Member, raw: z.input<typeof postInput>) {
  const input = postInput.parse(raw);
  await requireConduct(member);
  const [recent] = await db
    .select({ n: count() })
    .from(showcasePosts)
    .where(and(eq(showcasePosts.authorId, member.id), gte(showcasePosts.createdAt, new Date(Date.now() - 86_400_000))));
  if (recent.n >= POSTS_PER_DAY) throw new ServiceError("You've shared 5 projects today. Post the next one tomorrow (and review someone else's meanwhile).");
  const [post] = await db
    .insert(showcasePosts)
    .values({ ...fields(input), authorId: member.id, safetyConfirmedAt: new Date() })
    .returning();
  return post;
}

async function ownPost(member: Member, postId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new ServiceError("Project not found.");
  const [post] = await db.select().from(showcasePosts).where(and(eq(showcasePosts.id, postId), isNull(showcasePosts.removedAt)));
  if (!post || post.authorId !== member.id) throw new ServiceError("Project not found.");
  return post;
}

/** The author: edits a post (and confirms the safety checklist again). */
export async function updatePost(member: Member, postId: string, raw: z.input<typeof postInput>) {
  const input = postInput.parse(raw);
  await ownPost(member, postId);
  const [post] = await db
    .update(showcasePosts)
    .set({ ...fields(input), safetyConfirmedAt: new Date() })
    .where(eq(showcasePosts.id, postId))
    .returning();
  return post;
}

export async function setPostStatus(member: Member, postId: string, status: PostStatus) {
  if (!(status in STATUS_LABEL)) throw new ServiceError("Unknown status.");
  await ownPost(member, postId);
  await db.update(showcasePosts).set({ status }).where(eq(showcasePosts.id, postId));
}

/** The author: takes a post down (it disappears with its screenshots and reviews). */
export async function removePost(member: Member, postId: string) {
  await ownPost(member, postId);
  await db.update(showcasePosts).set({ removedAt: new Date() }).where(eq(showcasePosts.id, postId));
}

export { FEEDBACK_AREAS, NEEDS, STATUS_LABEL, type PostStatus };
export { videoHost } from "./showcase-labels";

// --- Screenshots ------------------------------------------------------------------------------

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const screenshotsAvailable = () => storage() !== null;

/** The author: adds a screenshot (PNG, JPG, WebP or GIF, up to 4 MB; at most four per post). */
export async function addScreenshot(member: Member, postId: string, file: { name: string; bytes: Uint8Array }) {
  await ownPost(member, postId);
  const store = storage();
  if (!store) throw new ServiceError("Screenshots can't be stored on this environment yet.");
  const checked = checkFile(file.name, file.bytes);
  if ("error" in checked) throw new ServiceError(checked.error);
  if (!IMAGE_TYPES.includes(checked.contentType)) throw new ServiceError("Screenshots must be PNG, JPG, WebP or GIF images.");
  const existing = await db
    .select({ position: showcaseImages.position, sha256: showcaseImages.sha256 })
    .from(showcaseImages)
    .where(and(eq(showcaseImages.postId, postId), isNull(showcaseImages.removedAt)));
  if (existing.length >= MAX_IMAGES) throw new ServiceError(`A project can have ${MAX_IMAGES} screenshots. Remove one first.`);
  // Phase 26.1: identical pictures are stored once (stored files are never deleted, so sharing is safe).
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  if (existing.some((r) => r.sha256 === sha256)) throw new ServiceError("This screenshot is already on the project.");
  const [same] = await db
    .select({ storageKey: showcaseImages.storageKey })
    .from(showcaseImages)
    .where(and(eq(showcaseImages.sha256, sha256), eq(showcaseImages.contentType, checked.contentType)))
    .limit(1);
  const ext = checked.contentType.split("/")[1].replace("jpeg", "jpg");
  const key = same?.storageKey ?? (await store.put(`community/showcase/${sha256.slice(0, 2)}/${sha256}.${ext}`, file.bytes, checked.contentType));
  const position = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1;
  const [image] = await db
    .insert(showcaseImages)
    .values({ postId, storageKey: key, contentType: checked.contentType, sizeBytes: checked.sizeBytes, sha256, position })
    .returning();
  return image;
}

export async function removeScreenshot(member: Member, imageId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) throw new ServiceError("Screenshot not found.");
  const [image] = await db.select().from(showcaseImages).where(and(eq(showcaseImages.id, imageId), isNull(showcaseImages.removedAt)));
  if (!image) throw new ServiceError("Screenshot not found.");
  await ownPost(member, image.postId);
  await db.update(showcaseImages).set({ removedAt: new Date() }).where(eq(showcaseImages.id, imageId));
}

/** A screenshot's bytes, for whoever may see its post. */
export async function openScreenshot(postId: string, imageId: string, viewer: Member | null) {
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) return null;
  const post = await visiblePost(postId, viewer);
  if (!post) return null;
  const [image] = await db
    .select()
    .from(showcaseImages)
    .where(and(eq(showcaseImages.id, imageId), eq(showcaseImages.postId, post.id), isNull(showcaseImages.removedAt)));
  const store = storage();
  if (!image || !store) return null;
  const file = await store.get(image.storageKey);
  return file ? { image, body: file.body } : null;
}

// --- Reading ----------------------------------------------------------------------------------

/** The post if this viewer may see it: not removed; hidden ones only for the author and organizers. */
async function visiblePost(postId: string, viewer: Member | null) {
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return null;
  const [row] = await db
    .select({ post: showcasePosts, active: users.active })
    .from(showcasePosts)
    .innerJoin(users, eq(users.id, showcasePosts.authorId))
    .where(and(eq(showcasePosts.id, postId), isNull(showcasePosts.removedAt)));
  if (!row) return null;
  const self = viewer?.id === row.post.authorId;
  if (self) return row.post;
  if (row.post.hiddenAt || !row.active) return (await viewerIsOrganizer(viewer)) ? row.post : null;
  if (row.post.visibility === "MEMBERS" && !viewer) return null;
  return row.post;
}

const reviewCount = sql<number>`(SELECT count(*)::int FROM showcase_reviews r WHERE r.post_id = ${showcasePosts.id} AND r.hidden_at IS NULL)`;
const cover = sql<string | null>`(SELECT i.id::text FROM showcase_images i WHERE i.post_id = ${showcasePosts.id} AND i.removed_at IS NULL ORDER BY i.position LIMIT 1)`;

const cardFields = {
  id: showcasePosts.id,
  title: showcasePosts.title,
  pitch: showcasePosts.pitch,
  builtWith: showcasePosts.builtWith,
  aiBuilt: showcasePosts.aiBuilt,
  status: showcasePosts.status,
  feedbackAreas: showcasePosts.feedbackAreas,
  createdAt: showcasePosts.createdAt,
  authorName: users.name,
  authorHandle: memberProfiles.handle,
  reviews: reviewCount,
  coverId: cover,
};
export type PostCard = {
  id: string;
  title: string;
  pitch: string;
  builtWith: string[];
  aiBuilt: boolean;
  status: string;
  feedbackAreas: string[];
  createdAt: Date;
  authorName: string;
  authorHandle: string | null;
  reviews: number;
  coverId: string | null;
};

const listable = (viewer: Member | null) =>
  and(isNull(showcasePosts.removedAt), isNull(showcasePosts.hiddenAt), eq(users.active, true), viewer ? undefined : eq(showcasePosts.visibility, "PUBLIC"));

export const SHOWCASE_PAGE = 24;

export async function listPosts(viewer: Member | null, filters: { status?: string; q?: string; authorId?: string; page?: number; order?: "new" | "needs-review" } = {}) {
  const q = filters.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const page = Math.max(1, Math.min(filters.page ?? 1, 1000));
  const rows = await db
    .select(cardFields)
    .from(showcasePosts)
    .innerJoin(users, eq(users.id, showcasePosts.authorId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, showcasePosts.authorId))
    .where(
      and(
        listable(viewer),
        filters.status && filters.status in STATUS_LABEL ? eq(showcasePosts.status, filters.status) : undefined,
        filters.authorId ? eq(showcasePosts.authorId, filters.authorId) : undefined,
        like
          ? or(ilike(showcasePosts.title, like), ilike(showcasePosts.pitch, like), sql`array_to_string(${showcasePosts.builtWith}, ' ') ILIKE ${like}`)
          : undefined,
      ),
    )
    .orderBy(...(filters.order === "needs-review" ? [asc(reviewCount), asc(showcasePosts.createdAt)] : [desc(showcasePosts.createdAt)]))
    .limit(SHOWCASE_PAGE + 1)
    .offset((page - 1) * SHOWCASE_PAGE);
  return { posts: rows.slice(0, SHOWCASE_PAGE) as PostCard[], more: rows.length > SHOWCASE_PAGE, page };
}

/** Projects waiting for feedback, fewest reviews first: not the viewer's own, nor ones they reviewed. */
export async function reviewRequests(viewer: Member, limit = 3): Promise<PostCard[]> {
  const { posts } = await listPosts(viewer, { status: "NEEDS_REVIEW", order: "needs-review" });
  if (posts.length === 0) return [];
  const done = await db
    .select({ postId: showcaseReviews.postId })
    .from(showcaseReviews)
    .where(and(eq(showcaseReviews.reviewerId, viewer.id), inArray(showcaseReviews.postId, posts.map((p) => p.id))));
  const reviewed = new Set(done.map((d) => d.postId));
  const mine = new Set((await db.select({ id: showcasePosts.id }).from(showcasePosts).where(eq(showcasePosts.authorId, viewer.id))).map((p) => p.id));
  return posts.filter((p) => !reviewed.has(p.id) && !mine.has(p.id)).slice(0, limit);
}

export type ReviewView = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerHandle: string | null;
  reviewerIsReviewer: boolean;
  whatWorks: string;
  toImprove: string | null;
  nextStep: string;
  /** Phase 36: the back-and-forth between the project's author and the reviewer, oldest first. */
  replies: { id: string; authorName: string; byPostAuthor: boolean; body: string; createdAt: Date }[];
  hidden: boolean;
  hiddenReason: string | null;
  createdAt: Date;
};

/** A post page: the post, its author, screenshots and reviews, and what the viewer may do. */
export async function getPost(postId: string, viewer: Member | null) {
  const post = await visiblePost(postId, viewer);
  if (!post) return null;
  const organizer = await viewerIsOrganizer(viewer);
  const self = viewer?.id === post.authorId;
  const [author] = await db
    .select({ name: users.name, handle: memberProfiles.handle, reviewer: memberProfiles.reviewer })
    .from(users)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
    .where(eq(users.id, post.authorId));
  const images = await db
    .select({ id: showcaseImages.id })
    .from(showcaseImages)
    .where(and(eq(showcaseImages.postId, post.id), isNull(showcaseImages.removedAt)))
    .orderBy(asc(showcaseImages.position));
  const rows = await db
    .select({ r: showcaseReviews, name: users.name, handle: memberProfiles.handle, isReviewer: memberProfiles.reviewer })
    .from(showcaseReviews)
    .innerJoin(users, eq(users.id, showcaseReviews.reviewerId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, showcaseReviews.reviewerId))
    .where(eq(showcaseReviews.postId, post.id))
    .orderBy(asc(showcaseReviews.createdAt));
  const replies = rows.length
    ? await db
        .select({ id: showcaseReviewReplies.id, reviewId: showcaseReviewReplies.reviewId, authorId: showcaseReviewReplies.authorId, authorName: users.name, body: showcaseReviewReplies.body, createdAt: showcaseReviewReplies.createdAt })
        .from(showcaseReviewReplies)
        .innerJoin(users, eq(users.id, showcaseReviewReplies.authorId))
        .where(inArray(showcaseReviewReplies.reviewId, rows.map(({ r }) => r.id)))
        .orderBy(asc(showcaseReviewReplies.createdAt))
    : [];
  const reviews: ReviewView[] = rows
    .filter(({ r }) => !r.hiddenAt || organizer || r.reviewerId === viewer?.id)
    .map(({ r, name, handle, isReviewer }) => ({
      id: r.id,
      reviewerId: r.reviewerId,
      reviewerName: name,
      reviewerHandle: handle,
      reviewerIsReviewer: !!isReviewer,
      whatWorks: r.whatWorks,
      toImprove: r.toImprove,
      nextStep: r.nextStep,
      replies: replies
        .filter((x) => x.reviewId === r.id)
        .map((x) => ({ id: x.id, authorName: x.authorName, byPostAuthor: x.authorId === post.authorId, body: x.body, createdAt: x.createdAt })),
      hidden: !!r.hiddenAt,
      hiddenReason: r.hiddenReason,
      createdAt: r.createdAt,
    }));
  const reviewed = viewer ? rows.some(({ r }) => r.reviewerId === viewer.id) : false;
  return { post, author: { name: author.name, handle: author.handle, reviewer: !!author.reviewer }, images: images.map((i) => i.id), reviews, self, organizer, reviewed };
}

/** How much a member has shared and given back (the handbook: one review per project posted). */
export async function giveBack(userId: string) {
  const [posts] = await db
    .select({ n: count() })
    .from(showcasePosts)
    .where(and(eq(showcasePosts.authorId, userId), isNull(showcasePosts.removedAt)));
  const [reviews] = await db
    .select({ n: count() })
    .from(showcaseReviews)
    .innerJoin(showcasePosts, eq(showcasePosts.id, showcaseReviews.postId))
    .where(and(eq(showcaseReviews.reviewerId, userId), isNull(showcaseReviews.hiddenAt), isNull(showcasePosts.removedAt)));
  return { posts: posts.n, reviews: reviews.n };
}

// --- Reviews ----------------------------------------------------------------------------------

export const reviewInput = z.object({
  whatWorks: z.string().trim().min(10, "Start with what works (at least 10 characters)").max(1500),
  toImprove: optionalText(1500, "What to improve"),
  nextStep: z.string().trim().min(10, "Suggest one next step they can take today (at least 10 characters)").max(1000),
});

/** Any member (not the author): reviews a project. The author gets an email. */
export async function addReview(member: Member, postId: string, raw: z.input<typeof reviewInput>) {
  const input = reviewInput.parse(raw);
  await requireConduct(member);
  const post = await visiblePost(postId, member);
  if (!post || post.hiddenAt) throw new ServiceError("Project not found.");
  if (post.authorId === member.id) throw new ServiceError("You can't review your own project. Ask the community instead!");
  const [review] = await db.insert(showcaseReviews).values({ ...input, postId: post.id, reviewerId: member.id }).onConflictDoNothing().returning();
  if (!review) throw new ServiceError("You already reviewed this project.");
  // The first review moves a request to "Reviewed" (the author can still mark it shipped).
  await db.update(showcasePosts).set({ status: "REVIEWED" }).where(and(eq(showcasePosts.id, post.id), eq(showcasePosts.status, "NEEDS_REVIEW")));
  const [author] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, post.authorId));
  await sendAccountEmail(author.email, newReviewMessage({ name: author.name, reviewer: member.name, title: post.title, url: appUrl(`/showcase/${post.id}#reviews`) })).catch((error) =>
    console.error("New review email failed", post.id, error instanceof Error ? error.message : error),
  );
  return review;
}

export const replyInput = z.object({ reply: z.string().trim().min(2, "Write a short reply").max(1000) });

/** The post's author answers a review (once). */
const MAX_REPLIES = 50;

/**
 * Phase 36: the project's author and the reviewer reply to each other under a review, as often as
 * they need (the other one gets an email).
 */
export async function replyToReview(member: Member, reviewId: string, raw: z.input<typeof replyInput>) {
  const input = replyInput.parse(raw);
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw new ServiceError("Review not found.");
  const [row] = await db
    .select({ review: showcaseReviews, authorId: showcasePosts.authorId, title: showcasePosts.title, postId: showcasePosts.id })
    .from(showcaseReviews)
    .innerJoin(showcasePosts, eq(showcasePosts.id, showcaseReviews.postId))
    .where(and(eq(showcaseReviews.id, reviewId), isNull(showcasePosts.removedAt)));
  if (!row || (row.authorId !== member.id && row.review.reviewerId !== member.id)) throw new ServiceError("Review not found.");
  if (row.review.hiddenAt) throw new ServiceError("This feedback was hidden by the organizers.");
  const [{ n }] = await db.select({ n: count() }).from(showcaseReviewReplies).where(eq(showcaseReviewReplies.reviewId, reviewId));
  if (n >= MAX_REPLIES) throw new ServiceError("This conversation is long: continue it in the community chat.");
  await db.insert(showcaseReviewReplies).values({ reviewId, authorId: member.id, body: input.reply });
  const otherId = member.id === row.authorId ? row.review.reviewerId : row.authorId;
  const [other] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, otherId));
  if (other && otherId !== member.id) {
    await sendAccountEmail(other.email, reviewReplyMessage({ name: other.name, from: member.name, title: row.title, reply: input.reply, url: appUrl(`/showcase/${row.postId}#reviews`) })).catch((error) =>
      console.error("Review reply email failed", reviewId, error instanceof Error ? error.message : error),
    );
  }
}

// --- Reports and moderation ------------------------------------------------------------------

/** Any member: reports a post to the organizers. */
export async function reportPost(member: Member, postId: string, raw: z.input<typeof reportInput>) {
  const post = await visiblePost(postId, member);
  if (!post) throw new ServiceError("Project not found.");
  if (post.authorId === member.id) throw new ServiceError("You can't report your own project.");
  return fileReport(member, "POST", post.id, raw);
}

/** Any member: reports a review to the organizers. */
export async function reportReview(member: Member, reviewId: string, raw: z.input<typeof reportInput>) {
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw new ServiceError("Review not found.");
  const [review] = await db.select().from(showcaseReviews).where(eq(showcaseReviews.id, reviewId));
  if (!review || !(await visiblePost(review.postId, member))) throw new ServiceError("Review not found.");
  if (review.reviewerId === member.id) throw new ServiceError("You can't report your own review.");
  return fileReport(member, "REVIEW", review.id, raw);
}

async function requireOrganizerHere(member: Member) {
  if (!(await viewerIsOrganizer(member))) throw new ServiceError("Only community organizers can do that.");
}

/** Organizers: shows a hidden post or review again. */
export async function unhideShowcase(member: Member, targetType: "POST" | "REVIEW", id: string) {
  await requireOrganizerHere(member);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ServiceError("Not found.");
  const clear = { hiddenAt: null, hiddenBy: null, hiddenReason: null };
  if (targetType === "POST") await db.update(showcasePosts).set(clear).where(eq(showcasePosts.id, id));
  else await db.update(showcaseReviews).set(clear).where(eq(showcaseReviews.id, id));
}
