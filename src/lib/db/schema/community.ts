import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Phase 25: the community (Ghana Vibe Coders & Developers). Unlike company data, it is shared by
// everyone on the platform, so these tables have no organization_id. The app role has no access;
// the server reads and writes them through the owner connection after its own checks
// (src/modules/community).

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());
const userRef = (name: string) => uuid(name).references(() => users.id, { onDelete: "restrict" });
const httpsUrl = (column: unknown) => sql`${column} IS NULL OR ${column} ~ '^https://[^\\s]+$'`;

/** One public profile per person: who they are, what they build, and their community role. */
export const memberProfiles = pgTable(
  "member_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    // The profile's address: /members/<handle>.
    handle: text("handle").notNull(),
    headline: text("headline"),
    bio: text("bio"),
    city: text("city"),
    tools: text("tools").array().notNull().default(sql`'{}'::text[]`),
    websiteUrl: text("website_url"),
    githubUrl: text("github_url"),
    linkedinUrl: text("linkedin_url"),
    xUrl: text("x_url"),
    // Volunteers to review work and mentor (the handbook's Reviewer role).
    reviewer: boolean("reviewer").notNull().default(false),
    wantsMentor: boolean("wants_mentor").notNull().default(false),
    // BUILDER (everyone) or ORGANIZER (moderators).
    communityRole: text("community_role").notNull().default("BUILDER"),
    // PUBLIC: anyone can see it; MEMBERS: only signed-in members.
    visibility: text("visibility").notNull().default("PUBLIC"),
    conductAcceptedAt: timestamp("conduct_accepted_at", { withTimezone: true }),
    // Hidden by an organizer (after a report): nobody else sees it.
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("member_profiles_handle").on(t.handle),
    index("member_profiles_created_idx").on(t.createdAt),
    check("member_profiles_handle_format", sql`${t.handle} ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'`),
    check("member_profiles_headline", sql`${t.headline} IS NULL OR length(${t.headline}) <= 140`),
    check("member_profiles_bio", sql`${t.bio} IS NULL OR length(${t.bio}) <= 1500`),
    check("member_profiles_city", sql`${t.city} IS NULL OR length(${t.city}) <= 60`),
    check("member_profiles_tools", sql`cardinality(${t.tools}) <= 15`),
    check("member_profiles_role", sql`${t.communityRole} IN ('BUILDER', 'ORGANIZER')`),
    check("member_profiles_visibility", sql`${t.visibility} IN ('PUBLIC', 'MEMBERS')`),
    check("member_profiles_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
    check("member_profiles_urls", sql`(${httpsUrl(t.websiteUrl)}) AND (${httpsUrl(t.githubUrl)}) AND (${httpsUrl(t.linkedinUrl)}) AND (${httpsUrl(t.xUrl)})`),
  ],
);

/** Something reported to the organizers (Phase 25: profiles; Phase 26: showcase posts and reviews). */
export const communityReports = pgTable(
  "community_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: userRef("reporter_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text("reason").notNull(),
    // OPEN, then RESOLVED (action taken) or DISMISSED (nothing wrong).
    status: text("status").notNull().default("OPEN"),
    resolution: text("resolution"),
    resolvedBy: userRef("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index("community_reports_status_idx").on(t.status, t.createdAt),
    // One open report per person and thing.
    uniqueIndex("community_reports_one_open").on(t.reporterId, t.targetType, t.targetId).where(sql`${t.status} = 'OPEN'`),
    check("community_reports_target", sql`${t.targetType} IN ('PROFILE', 'POST', 'REVIEW')`),
    check("community_reports_reason", sql`length(btrim(${t.reason})) BETWEEN 10 AND 1000`),
    check("community_reports_status", sql`${t.status} IN ('OPEN', 'RESOLVED', 'DISMISSED')`),
    check("community_reports_resolved", sql`(${t.status} = 'OPEN') = (${t.resolvedAt} IS NULL) AND (${t.resolvedAt} IS NULL) = (${t.resolvedBy} IS NULL)`),
  ],
);

// --- Phase 26: the showcase -------------------------------------------------------------------

/**
 * A project a member shares, following the handbook's posting template. Status: NEEDS_REVIEW (wants
 * feedback), REVIEWED (has feedback), SHIPPED (launched).
 */
export const showcasePosts = pgTable(
  "showcase_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: userRef("author_id").notNull(),
    title: text("title").notNull(),
    // What it does, in one sentence.
    pitch: text("pitch").notNull(),
    audience: text("audience"),
    builtWith: text("built_with").array().notNull().default(sql`'{}'::text[]`),
    // AI tools wrote most of it (the handbook asks builders to say so).
    aiBuilt: boolean("ai_built").notNull().default(false),
    liveUrl: text("live_url"),
    repoUrl: text("repo_url"),
    videoUrl: text("video_url"),
    // DESIGN, CODE, SECURITY, IDEA, UX
    feedbackAreas: text("feedback_areas").array().notNull().default(sql`'{}'::text[]`),
    feedbackWanted: text("feedback_wanted"),
    stuckOn: text("stuck_on"),
    // TESTERS, FEEDBACK, USERS, COLLABORATORS
    needs: text("needs").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("NEEDS_REVIEW"),
    visibility: text("visibility").notNull().default("PUBLIC"),
    // The author confirmed the code safety checklist (no secrets, login on private pages, no personal data).
    safetyConfirmedAt: timestamp("safety_confirmed_at", { withTimezone: true }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("showcase_posts_created_idx").on(t.createdAt),
    index("showcase_posts_author_idx").on(t.authorId, t.createdAt),
    check("showcase_posts_title", sql`length(btrim(${t.title})) BETWEEN 2 AND 120`),
    check("showcase_posts_pitch", sql`length(btrim(${t.pitch})) BETWEEN 10 AND 200`),
    check("showcase_posts_audience", sql`${t.audience} IS NULL OR length(${t.audience}) <= 200`),
    check("showcase_posts_texts", sql`(${t.feedbackWanted} IS NULL OR length(${t.feedbackWanted}) <= 1000) AND (${t.stuckOn} IS NULL OR length(${t.stuckOn}) <= 1000)`),
    check("showcase_posts_built_with", sql`cardinality(${t.builtWith}) <= 15`),
    check("showcase_posts_areas", sql`${t.feedbackAreas} <@ ARRAY['DESIGN', 'CODE', 'SECURITY', 'IDEA', 'UX']::text[]`),
    check("showcase_posts_needs", sql`${t.needs} <@ ARRAY['TESTERS', 'FEEDBACK', 'USERS', 'COLLABORATORS']::text[]`),
    check("showcase_posts_status", sql`${t.status} IN ('NEEDS_REVIEW', 'REVIEWED', 'SHIPPED')`),
    check("showcase_posts_visibility", sql`${t.visibility} IN ('PUBLIC', 'MEMBERS')`),
    check("showcase_posts_urls", sql`(${httpsUrl(t.liveUrl)}) AND (${httpsUrl(t.repoUrl)}) AND (${httpsUrl(t.videoUrl)})`),
    check("showcase_posts_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

/** Screenshots of a post (up to four), kept in the app's file storage and served through the app. */
export const showcaseImages = pgTable(
  "showcase_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => showcasePosts.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    position: integer("position").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index("showcase_images_post_idx").on(t.postId, t.position),
    check("showcase_images_type", sql`${t.contentType} IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`),
    check("showcase_images_size", sql`${t.sizeBytes} BETWEEN 1 AND 4194304`),
  ],
);

/**
 * Feedback on a post, in the handbook's shape: what works, what to improve, one next step. One per
 * reviewer and post; the author may answer it once.
 */
export const showcaseReviews = pgTable(
  "showcase_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => showcasePosts.id, { onDelete: "restrict" }),
    reviewerId: userRef("reviewer_id").notNull(),
    whatWorks: text("what_works").notNull(),
    toImprove: text("to_improve"),
    nextStep: text("next_step").notNull(),
    authorReply: text("author_reply"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
  },
  (t) => [
    uniqueIndex("showcase_reviews_one_each").on(t.postId, t.reviewerId),
    index("showcase_reviews_reviewer_idx").on(t.reviewerId),
    check("showcase_reviews_works", sql`length(btrim(${t.whatWorks})) BETWEEN 10 AND 1500`),
    check("showcase_reviews_improve", sql`${t.toImprove} IS NULL OR length(${t.toImprove}) <= 1500`),
    check("showcase_reviews_next", sql`length(btrim(${t.nextStep})) BETWEEN 10 AND 1000`),
    check("showcase_reviews_reply", sql`(${t.authorReply} IS NULL) = (${t.repliedAt} IS NULL) AND (${t.authorReply} IS NULL OR length(${t.authorReply}) BETWEEN 2 AND 1000)`),
    check("showcase_reviews_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);
