import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    // Phase 31: open to mentoring (Reviewers), for how many people at once, and what with.
    mentorOpen: boolean("mentor_open").notNull().default(false),
    mentorCapacity: integer("mentor_capacity").notNull().default(2),
    mentorNote: text("mentor_note"),
    // BUILDER (everyone) or ORGANIZER (moderators).
    communityRole: text("community_role").notNull().default("BUILDER"),
    // PUBLIC: anyone can see it; MEMBERS: only signed-in members.
    visibility: text("visibility").notNull().default("PUBLIC"),
    conductAcceptedAt: timestamp("conduct_accepted_at", { withTimezone: true }),
    // Hidden by an organizer (after a report): nobody else sees it.
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    // Phase 41: AGOD staff lifted the new-account limits early (posting jobs, links in chat, mentorship).
    trustedAt: timestamp("trusted_at", { withTimezone: true }),
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
    check("member_profiles_mentor_capacity", sql`${t.mentorCapacity} BETWEEN 1 AND 5`),
    check("member_profiles_mentor_note", sql`${t.mentorNote} IS NULL OR length(${t.mentorNote}) <= 300`),
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
    check("community_reports_target", sql`${t.targetType} IN ('PROFILE', 'POST', 'REVIEW', 'SESSION', 'LIBRARY', 'JOB', 'TEAM', 'CHAT', 'ARTICLE', 'ARTICLE_COMMENT')`),
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
    // Phase 26.1: SHA-256 of the bytes (hex). The same picture is stored once and shared.
    sha256: text("sha256"),
    position: integer("position").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index("showcase_images_post_idx").on(t.postId, t.position),
    index("showcase_images_sha256_idx").on(t.sha256),
    check("showcase_images_sha256", sql`${t.sha256} IS NULL OR ${t.sha256} ~ '^[0-9a-f]{64}$'`),
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

// --- Phase 27: teaching sessions ------------------------------------------------------------

/**
 * A live group session a member hosts (handbook: teaching sessions). The call itself runs on
 * Google Meet, Zoom or Discord; its link is shown only to the host, people who joined and organizers.
 */
export const communitySessions = pgTable(
  "community_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: userRef("host_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // BEGINNER, INTERMEDIATE, ALL
    level: text("level").notNull().default("ALL"),
    topics: text("topics").array().notNull().default(sql`'{}'::text[]`),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    callUrl: text("call_url").notNull(),
    // Most people who can join (null: no limit).
    capacity: integer("capacity"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    // After the session: the recording and key notes (handbook: post them for people who missed it).
    recordingUrl: text("recording_url"),
    notes: text("notes"),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("community_sessions_starts_idx").on(t.startsAt),
    index("community_sessions_host_idx").on(t.hostId),
    check("community_sessions_title", sql`length(btrim(${t.title})) BETWEEN 3 AND 120`),
    check("community_sessions_description", sql`length(btrim(${t.description})) BETWEEN 10 AND 3000`),
    check("community_sessions_level", sql`${t.level} IN ('BEGINNER', 'INTERMEDIATE', 'ALL')`),
    check("community_sessions_topics", sql`cardinality(${t.topics}) <= 8`),
    check("community_sessions_times", sql`${t.endsAt} > ${t.startsAt} AND ${t.endsAt} <= ${t.startsAt} + interval '6 hours'`),
    check("community_sessions_capacity", sql`${t.capacity} IS NULL OR ${t.capacity} BETWEEN 2 AND 1000`),
    check("community_sessions_urls", sql`(${t.callUrl} ~ '^https://[^\\s]+$') AND (${httpsUrl(t.recordingUrl)})`),
    check("community_sessions_notes", sql`${t.notes} IS NULL OR length(${t.notes}) <= 5000`),
    check("community_sessions_cancelled", sql`(${t.cancelledAt} IS NULL) = (${t.cancelReason} IS NULL)`),
    check("community_sessions_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

/** Who joined a session (and whether they got the reminder email). */
export const communitySessionAttendees = pgTable(
  "community_session_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => communitySessions.id, { onDelete: "restrict" }),
    userId: userRef("user_id").notNull(),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [uniqueIndex("community_session_attendees_one").on(t.sessionId, t.userId), index("community_session_attendees_user_idx").on(t.userId)],
);

// Phase 31: mentorship, the tools & prompts library, and project of the month.

/** A member asks a mentor for help with a goal; the mentor accepts or declines. */
export const mentorships = pgTable(
  "mentorships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mentorId: userRef("mentor_id").notNull(),
    menteeId: userRef("mentee_id").notNull(),
    goal: text("goal").notNull(),
    // PENDING → ACTIVE (accepted) or DECLINED; WITHDRAWN by the mentee before an answer; ENDED by either.
    status: text("status").notNull().default("PENDING"),
    responseNote: text("response_note"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: userRef("ended_by"),
    createdAt,
  },
  (t) => [
    index("mentorships_mentor_idx").on(t.mentorId),
    index("mentorships_mentee_idx").on(t.menteeId),
    uniqueIndex("mentorships_one_open").on(t.mentorId, t.menteeId).where(sql`${t.status} IN ('PENDING', 'ACTIVE')`),
    check("mentorships_status", sql`${t.status} IN ('PENDING', 'ACTIVE', 'DECLINED', 'WITHDRAWN', 'ENDED')`),
    check("mentorships_self", sql`${t.mentorId} <> ${t.menteeId}`),
    check("mentorships_goal", sql`length(btrim(${t.goal})) BETWEEN 10 AND 500`),
    check("mentorships_note", sql`${t.responseNote} IS NULL OR length(${t.responseNote}) <= 500`),
  ],
);

/** A tool, a prompt that works, or a guide, shared by a member. */
export const libraryItems = pgTable(
  "library_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: userRef("author_id").notNull(),
    // TOOL (a link), PROMPT (the text to copy), GUIDE (a link to a tutorial or article)
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    url: text("url"),
    body: text("body"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // Works on a slow or costly connection (the handbook's Ghana note), and free to use.
    lowData: boolean("low_data").notNull().default(false),
    free: boolean("free").notNull().default(false),
    featuredAt: timestamp("featured_at", { withTimezone: true }),
    featuredBy: userRef("featured_by"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("library_items_created_idx").on(t.createdAt),
    check("library_items_kind", sql`${t.kind} IN ('TOOL', 'PROMPT', 'GUIDE')`),
    check("library_items_title", sql`length(btrim(${t.title})) BETWEEN 3 AND 120`),
    check("library_items_summary", sql`length(btrim(${t.summary})) BETWEEN 10 AND 300`),
    check("library_items_url", httpsUrl(t.url)),
    check("library_items_body", sql`${t.body} IS NULL OR length(${t.body}) <= 4000`),
    check("library_items_content", sql`(${t.kind} = 'PROMPT' AND ${t.body} IS NOT NULL) OR (${t.kind} <> 'PROMPT' AND ${t.url} IS NOT NULL)`),
    check("library_items_tags", sql`cardinality(${t.tags}) <= 8`),
    check("library_items_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

/** "Useful" marks on library items: one per member and item. */
export const libraryVotes = pgTable(
  "library_votes",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "restrict" }),
    voterId: userRef("voter_id").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("library_votes_unique").on(t.itemId, t.voterId)],
);

/** Each member's vote for project of the month: one per month, never their own project. */
export const projectVotes = pgTable(
  "project_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => showcasePosts.id, { onDelete: "restrict" }),
    voterId: userRef("voter_id").notNull(),
    // "2026-10" (Accra time)
    month: text("month").notNull(),
    createdAt,
  },
  (t) => [
    uniqueIndex("project_votes_one_per_month").on(t.voterId, t.month),
    index("project_votes_month_idx").on(t.month, t.postId),
    check("project_votes_month", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

/** The month's winner: the most votes when the month ends, or an organizer's pick. */
export const projectOfMonth = pgTable(
  "project_of_month",
  {
    month: text("month").primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => showcasePosts.id, { onDelete: "restrict" }),
    votes: integer("votes").notNull().default(0),
    // Null when chosen by votes.
    pickedBy: userRef("picked_by"),
    note: text("note"),
    createdAt,
  },
  (t) => [
    check("project_of_month_month", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("project_of_month_note", sql`${t.note} IS NULL OR length(${t.note}) <= 500`),
  ],
);

// Phase 33: the jobs & gigs board. Members (and companies through a member) post paid work;
// members apply with a short message and their profile. Pay is in minor units (pesewas).
export const communityJobs = pgTable(
  "community_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    posterId: userRef("poster_id").notNull(),
    // Who is hiring, as the poster writes it (a company, a project, or the poster's own name).
    hirer: text("hirer").notNull(),
    title: text("title").notNull(),
    // JOB (employment), GIG (a paid piece of work), INTERNSHIP
    kind: text("kind").notNull(),
    // REMOTE, ONSITE, HYBRID
    workMode: text("work_mode").notNull(),
    location: text("location"),
    payMinMinor: bigint("pay_min_minor", { mode: "number" }),
    payMaxMinor: bigint("pay_max_minor", { mode: "number" }),
    // PROJECT (for the whole gig), MONTH, HOUR
    payUnit: text("pay_unit"),
    currency: char("currency", { length: 3 }).notNull().default("GHS"),
    description: text("description").notNull(),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    closesOn: date("closes_on").notNull(),
    // OPEN → CLOSED (no longer taking applications) or FILLED
    status: text("status").notNull().default("OPEN"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    // Phase 41: a job the scam check flagged waits here until AGOD staff approve it (or hide it).
    heldAt: timestamp("held_at", { withTimezone: true }),
    heldReason: text("held_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("community_jobs_poster_idx").on(t.posterId),
    index("community_jobs_closes_idx").on(t.closesOn),
    check("community_jobs_kind", sql`${t.kind} IN ('JOB', 'GIG', 'INTERNSHIP')`),
    check("community_jobs_mode", sql`${t.workMode} IN ('REMOTE', 'ONSITE', 'HYBRID')`),
    check("community_jobs_status", sql`${t.status} IN ('OPEN', 'CLOSED', 'FILLED')`),
    check("community_jobs_title", sql`length(btrim(${t.title})) BETWEEN 5 AND 120`),
    check("community_jobs_hirer", sql`length(btrim(${t.hirer})) BETWEEN 2 AND 120`),
    check("community_jobs_description", sql`length(btrim(${t.description})) BETWEEN 30 AND 5000`),
    check("community_jobs_location", sql`${t.location} IS NULL OR length(${t.location}) <= 80`),
    check("community_jobs_skills", sql`cardinality(${t.skills}) <= 10`),
    // Jobs and gigs always say what they pay; internships may not.
    check("community_jobs_pay_stated", sql`${t.kind} = 'INTERNSHIP' OR ${t.payMinMinor} IS NOT NULL`),
    check(
      "community_jobs_pay",
      sql`(${t.payMinMinor} IS NULL) = (${t.payUnit} IS NULL) AND (${t.payMinMinor} IS NULL OR ${t.payMinMinor} > 0)
        AND (${t.payMaxMinor} IS NULL OR (${t.payMinMinor} IS NOT NULL AND ${t.payMaxMinor} >= ${t.payMinMinor}))`,
    ),
    check("community_jobs_unit", sql`${t.payUnit} IS NULL OR ${t.payUnit} IN ('PROJECT', 'MONTH', 'HOUR')`),
    check("community_jobs_closed", sql`(${t.status} = 'OPEN') = (${t.closedAt} IS NULL)`),
    check("community_jobs_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

export const jobApplications = pgTable(
  "job_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => communityJobs.id, { onDelete: "restrict" }),
    applicantId: userRef("applicant_id").notNull(),
    message: text("message").notNull(),
    link: text("link"),
    // SENT → SHORTLISTED → HIRED, or DECLINED; WITHDRAWN by the applicant
    status: text("status").notNull().default("SENT"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("job_applications_one").on(t.jobId, t.applicantId),
    index("job_applications_applicant_idx").on(t.applicantId),
    check("job_applications_status", sql`${t.status} IN ('SENT', 'SHORTLISTED', 'HIRED', 'DECLINED', 'WITHDRAWN')`),
    check("job_applications_message", sql`length(btrim(${t.message})) BETWEEN 20 AND 2000`),
    check("job_applications_link", httpsUrl(t.link)),
  ],
);

// Phase 33: the team finder. IDEA: "I'm building something and need people"; JOINING: "I want to
// join a team". Others send a short request; accepting shares both email addresses.
export const teamPosts = pgTable(
  "team_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: userRef("author_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // IDEA: roles needed; JOINING: roles the author can take.
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
    tools: text("tools").array().notNull().default(sql`'{}'::text[]`),
    commitment: text("commitment").notNull(),
    // LEARNING (for practice and the portfolio), SHARE (a share of what it earns), PAID
    reward: text("reward").notNull(),
    // OPEN → CLOSED
    status: text("status").notNull().default("OPEN"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("team_posts_author_idx").on(t.authorId),
    check("team_posts_kind", sql`${t.kind} IN ('IDEA', 'JOINING')`),
    check("team_posts_reward", sql`${t.reward} IN ('LEARNING', 'SHARE', 'PAID')`),
    check("team_posts_status", sql`${t.status} IN ('OPEN', 'CLOSED')`),
    check("team_posts_title", sql`length(btrim(${t.title})) BETWEEN 5 AND 120`),
    check("team_posts_description", sql`length(btrim(${t.description})) BETWEEN 20 AND 3000`),
    check("team_posts_commitment", sql`length(btrim(${t.commitment})) BETWEEN 2 AND 80`),
    check("team_posts_lists", sql`cardinality(${t.roles}) BETWEEN 1 AND 8 AND cardinality(${t.tools}) <= 10`),
    check("team_posts_closed", sql`(${t.status} = 'OPEN') = (${t.closedAt} IS NULL)`),
    check("team_posts_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

export const teamRequests = pgTable(
  "team_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => teamPosts.id, { onDelete: "restrict" }),
    fromId: userRef("from_id").notNull(),
    message: text("message").notNull(),
    // PENDING → ACCEPTED or DECLINED; WITHDRAWN by the sender
    status: text("status").notNull().default("PENDING"),
    responseNote: text("response_note"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex("team_requests_one").on(t.postId, t.fromId),
    index("team_requests_from_idx").on(t.fromId),
    check("team_requests_status", sql`${t.status} IN ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')`),
    check("team_requests_message", sql`length(btrim(${t.message})) BETWEEN 10 AND 1000`),
    check("team_requests_note", sql`${t.responseNote} IS NULL OR length(${t.responseNote}) <= 500`),
  ],
);

// Phase 35: the community front page: organizers choose background photos (a slideshow behind the
// welcome text) and a welcome video shown beside it.
export const frontPhotos = pgTable(
  "front_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    // What the photo shows, for screen readers.
    alt: text("alt").notNull(),
    position: integer("position").notNull().default(0),
    addedBy: userRef("added_by").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    check("front_photos_alt", sql`length(btrim(${t.alt})) BETWEEN 3 AND 200`),
    check("front_photos_type", sql`${t.contentType} IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`),
  ],
);

/** One row of settings for the community front page. */
export const communitySettings = pgTable(
  "community_settings",
  {
    id: integer("id").primaryKey().default(1),
    welcomeVideoUrl: text("welcome_video_url"),
    welcomeVideoTitle: text("welcome_video_title"),
    updatedBy: userRef("updated_by"),
    updatedAt,
  },
  (t) => [
    check("community_settings_one_row", sql`${t.id} = 1`),
    check("community_settings_video", httpsUrl(t.welcomeVideoUrl)),
    check("community_settings_title", sql`${t.welcomeVideoTitle} IS NULL OR length(btrim(${t.welcomeVideoTitle})) BETWEEN 2 AND 120`),
  ],
);

// Phase 36: back-and-forth on showcase feedback: the project's author and the reviewer reply to
// each other under a review (replaces the single author reply, which is copied in).
export const showcaseReviewReplies = pgTable(
  "showcase_review_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => showcaseReviews.id, { onDelete: "restrict" }),
    authorId: userRef("author_id").notNull(),
    body: text("body").notNull(),
    createdAt,
  },
  (t) => [index("showcase_review_replies_review_idx").on(t.reviewId, t.createdAt), check("showcase_review_replies_body", sql`length(btrim(${t.body})) BETWEEN 2 AND 1000`)],
);

// Phase 36: community chat, like Discord channels: everyone signed in reads and talks in topic
// channels; a message can start a thread of replies; questions in a questions channel can be
// marked solved.
export const chatChannels = pgTable(
  "chat_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    // CHAT (conversation) or QUESTIONS (each message is a question that can be marked solved)
    kind: text("kind").notNull().default("CHAT"),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex("chat_channels_slug").on(t.slug),
    check("chat_channels_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${t.slug}) <= 30`),
    check("chat_channels_kind", sql`${t.kind} IN ('CHAT', 'QUESTIONS')`),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "restrict" }),
    authorId: userRef("author_id").notNull(),
    // Set for replies in a thread: the message that started it.
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    mentionedIds: uuid("mentioned_ids").array().notNull().default(sql`'{}'::uuid[]`),
    replyCount: integer("reply_count").notNull().default(0),
    lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
    solvedAt: timestamp("solved_at", { withTimezone: true }),
    solvedBy: userRef("solved_by"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
    // Bumped on any change (reply, reaction, solved, removed), so open pages fetch only when something changed.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_messages_channel_idx").on(t.channelId, t.createdAt),
    index("chat_messages_parent_idx").on(t.parentId, t.createdAt),
    index("chat_messages_author_idx").on(t.authorId, t.createdAt),
    check("chat_messages_body", sql`length(btrim(${t.body})) BETWEEN 1 AND 2000`),
    check("chat_messages_mentions", sql`cardinality(${t.mentionedIds}) <= 10`),
    check("chat_messages_solved", sql`(${t.solvedAt} IS NULL) = (${t.solvedBy} IS NULL) AND (${t.solvedAt} IS NULL OR ${t.parentId} IS NULL)`),
    check("chat_messages_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

export const chatReactions = pgTable(
  "chat_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "restrict" }),
    userId: userRef("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("chat_reactions_unique").on(t.messageId, t.userId, t.emoji), check("chat_reactions_emoji", sql`length(${t.emoji}) BETWEEN 1 AND 16`)],
);

/** Where each person has read up to in each channel (for unread counts). */
export const chatReads = pgTable(
  "chat_reads",
  {
    userId: userRef("user_id").notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "restrict" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("chat_reads_unique").on(t.userId, t.channelId)],
);

// Phase 37: articles. Members write (drafts, then published); everyone reads; members mark them
// useful, comment and reply, bookmark, and repost with a note; Reviewers stamp them reviewed.
export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: userRef("author_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    body: text("body").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    readingMinutes: integer("reading_minutes").notNull().default(1),
    coverKey: text("cover_key"),
    coverType: text("cover_type"),
    coverBytes: integer("cover_bytes"),
    // DRAFT → PUBLISHED (and back to DRAFT to take it down for edits)
    status: text("status").notNull().default("DRAFT"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("articles_author_idx").on(t.authorId),
    index("articles_published_idx").on(t.publishedAt),
    check("articles_status", sql`${t.status} IN ('DRAFT', 'PUBLISHED')`),
    check("articles_published", sql`${t.status} = 'DRAFT' OR ${t.publishedAt} IS NOT NULL`),
    check("articles_title", sql`length(btrim(${t.title})) BETWEEN 5 AND 150`),
    check("articles_summary", sql`length(btrim(${t.summary})) BETWEEN 10 AND 300`),
    check("articles_body", sql`length(btrim(${t.body})) BETWEEN 50 AND 30000`),
    check("articles_tags", sql`cardinality(${t.tags}) <= 5`),
    check("articles_cover", sql`(${t.coverKey} IS NULL) = (${t.coverType} IS NULL) AND (${t.coverType} IS NULL OR ${t.coverType} IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))`),
    check("articles_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

export const articleClaps = pgTable(
  "article_claps",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "restrict" }),
    userId: userRef("user_id").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("article_claps_unique").on(t.articleId, t.userId)],
);

export const articleBookmarks = pgTable(
  "article_bookmarks",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "restrict" }),
    userId: userRef("user_id").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("article_bookmarks_unique").on(t.articleId, t.userId), index("article_bookmarks_user_idx").on(t.userId, t.createdAt)],
);

export const articleComments = pgTable(
  "article_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "restrict" }),
    authorId: userRef("author_id").notNull(),
    // A reply to another comment (one level).
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    hiddenReason: text("hidden_reason"),
    createdAt,
  },
  (t) => [
    index("article_comments_article_idx").on(t.articleId, t.createdAt),
    check("article_comments_body", sql`length(btrim(${t.body})) BETWEEN 2 AND 2000`),
    check("article_comments_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

/** A Reviewer's stamp: they read it and vouch for it, with a short note. */
export const articleReviews = pgTable(
  "article_reviews",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "restrict" }),
    reviewerId: userRef("reviewer_id").notNull(),
    note: text("note").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("article_reviews_unique").on(t.articleId, t.reviewerId), check("article_reviews_note", sql`length(btrim(${t.note})) BETWEEN 10 AND 500`)],
);

/** Sharing an article to your profile and the feed, with your own note on top. */
export const articleReposts = pgTable(
  "article_reposts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "restrict" }),
    userId: userRef("user_id").notNull(),
    note: text("note"),
    createdAt,
  },
  (t) => [
    uniqueIndex("article_reposts_unique").on(t.articleId, t.userId),
    index("article_reposts_created_idx").on(t.createdAt),
    check("article_reposts_note", sql`${t.note} IS NULL OR length(${t.note}) <= 280`),
  ],
);


// Phase 38: tech news. Headlines fetched from public feeds (RSS/Atom, Hacker News, DEV) on a
// schedule; the sources themselves are listed in code (src/modules/community/news.ts) and this
// table only keeps their state, so organizers can switch one off and see when it last worked.
export const newsSources = pgTable("news_sources", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt,
});

/** One headline: title, link and a short plain-text summary; the article stays on its own site. */
export const newsItems = pgTable(
  "news_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceKey: text("source_key")
      .notNull()
      .references(() => newsSources.key, { onDelete: "restrict" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    // AI, PROGRAMMING, AFRICA, RELEASES, TECH
    topic: text("topic").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    // Hacker News and DEV: points and comments there, and the link to that discussion.
    points: integer("points"),
    comments: integer("comments"),
    discussionUrl: text("discussion_url"),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: userRef("hidden_by"),
    createdAt,
  },
  (t) => [
    uniqueIndex("news_items_url_unique").on(t.url),
    index("news_items_published_idx").on(t.publishedAt),
    index("news_items_topic_idx").on(t.topic, t.publishedAt),
    check("news_items_topic", sql`${t.topic} IN ('AI', 'PROGRAMMING', 'AFRICA', 'RELEASES', 'TECH')`),
    check("news_items_url", sql`${t.url} ~ '^https://[^\\s]+$' AND length(${t.url}) <= 2000`),
    check("news_items_discussion_url", httpsUrl(t.discussionUrl)),
    check("news_items_title", sql`length(btrim(${t.title})) BETWEEN 1 AND 200`),
    check("news_items_summary", sql`${t.summary} IS NULL OR length(${t.summary}) <= 300`),
    check("news_items_hidden", sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL)`),
  ],
);

export const newsUseful = pgTable(
  "news_useful",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => newsItems.id, { onDelete: "cascade" }),
    userId: userRef("user_id").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("news_useful_unique").on(t.itemId, t.userId), index("news_useful_created_idx").on(t.createdAt)],
);

// Phase 41: trust & safety. Something a member wrote that the scam check (src/lib/risk.ts) found
// suspicious, waiting for AGOD staff: cleared (fine), or acted on (hidden, author banned).
export const riskFlags = pgTable(
  "risk_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // JOB, CHAT, ARTICLE, ARTICLE_COMMENT, POST, REVIEW, PROFILE, LIBRARY, TEAM
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    authorId: userRef("author_id").notNull(),
    score: integer("score").notNull(),
    signals: text("signals").array().notNull(),
    // A few words of what was matched, for the reviewer.
    excerpt: text("excerpt"),
    status: text("status").notNull().default("OPEN"),
    reviewedBy: userRef("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex("risk_flags_target_unique").on(t.targetType, t.targetId),
    index("risk_flags_status_idx").on(t.status, t.score),
    index("risk_flags_author_idx").on(t.authorId),
    check("risk_flags_target_type", sql`${t.targetType} IN ('JOB', 'CHAT', 'ARTICLE', 'ARTICLE_COMMENT', 'POST', 'REVIEW', 'PROFILE', 'LIBRARY', 'TEAM')`),
    check("risk_flags_status", sql`${t.status} IN ('OPEN', 'CLEARED', 'ACTIONED')`),
    check("risk_flags_score", sql`${t.score} BETWEEN 0 AND 100`),
    check("risk_flags_reviewed", sql`(${t.status} = 'OPEN') = (${t.reviewedAt} IS NULL)`),
  ],
);
