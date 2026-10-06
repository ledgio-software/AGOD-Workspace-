import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

/** Something reported to the organizers (Phase 25: profiles; later posts and comments too). */
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
    check("community_reports_target", sql`${t.targetType} IN ('PROFILE')`),
    check("community_reports_reason", sql`length(btrim(${t.reason})) BETWEEN 10 AND 1000`),
    check("community_reports_status", sql`${t.status} IN ('OPEN', 'RESOLVED', 'DISMISSED')`),
    check("community_reports_resolved", sql`(${t.status} = 'OPEN') = (${t.resolvedAt} IS NULL) AND (${t.resolvedAt} IS NULL) = (${t.resolvedBy} IS NULL)`),
  ],
);
