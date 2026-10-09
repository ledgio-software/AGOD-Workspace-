import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communityJobs, memberProfiles, platformAudit, riskFlags, users } from "@/lib/db/schema";
import { ensureProfile, type Member } from "@/modules/community";
import { ServiceError } from "@/modules/errors";
import { asStaff, setLoginBlocked } from "@/modules/platform";
import { type FlagTarget, type Standing, standing } from "./screen";

// Phase 41: trust & safety for AGOD staff (/console/safety): the risk queue the scam check fills,
// jobs held for a check, banning someone and hiding everything they posted in one go, and lifting
// the new-account limits early for people staff know. Every action is in the back-office log.

const reasonInput = z.string().trim().min(5, "Give a reason (at least 5 characters); it goes in the back-office log.").max(500, "Reason: at most 500 characters");
const validId = (id: string) => z.uuid().safeParse(id).success;

async function requireStaff(member: Member) {
  const staff = await asStaff(member);
  if (!staff) throw new ServiceError("Only AGOD back-office staff can do that.");
  return staff;
}

async function audit(staff: Member, action: string, targetType: "USER" | "CONTENT", targetId: string | null, targetLabel: string, reason?: string | null) {
  await db.insert(platformAudit).values({ actorId: staff.id, action, targetType, targetId, targetLabel: targetLabel.slice(0, 300), reason: reason ?? null });
}

/** Each kind of content: its table, the id and author columns, and how to name and link it. */
const CONTENT: Record<FlagTarget, { table: string; id: string; author: string; label: string; link: string; kind: string }> = {
  JOB: { table: "community_jobs", id: "id", author: "poster_id", label: "t.title", link: "'/jobs/' || t.id", kind: "Job" },
  CHAT: { table: "chat_messages", id: "id", author: "author_id", label: "left(t.body, 120)", link: "'/community/chat/' || (SELECT slug FROM chat_channels c WHERE c.id = t.channel_id) || '?thread=' || coalesce(t.parent_id, t.id)", kind: "Chat message" },
  ARTICLE: { table: "articles", id: "id", author: "author_id", label: "t.title", link: "'/articles/' || t.id", kind: "Article" },
  ARTICLE_COMMENT: { table: "article_comments", id: "id", author: "author_id", label: "left(t.body, 120)", link: "'/articles/' || t.article_id || '#comments'", kind: "Article comment" },
  POST: { table: "showcase_posts", id: "id", author: "author_id", label: "t.title", link: "'/showcase/' || t.id", kind: "Project" },
  REVIEW: { table: "showcase_reviews", id: "id", author: "reviewer_id", label: "left(t.what_works, 120)", link: "'/showcase/' || t.post_id || '#reviews'", kind: "Feedback" },
  PROFILE: { table: "member_profiles", id: "user_id", author: "user_id", label: "(SELECT name FROM users u WHERE u.id = t.user_id)", link: "'/members/' || t.handle", kind: "Profile" },
  LIBRARY: { table: "library_items", id: "id", author: "author_id", label: "t.title", link: "'/library/' || t.id", kind: "Tool or prompt" },
  TEAM: { table: "team_posts", id: "id", author: "author_id", label: "t.title", link: "'/teams/' || t.id", kind: "Team post" },
};

/** Content tables a ban cleans up (sessions too, which members with the Reviewer badge host). */
const CLEANUP: { table: string; author: string }[] = [
  ...Object.values(CONTENT).map((c) => ({ table: c.table, author: c.author })),
  { table: "community_sessions", author: "host_id" },
];

// --- The queue -------------------------------------------------------------------------------

export type QueueItem = {
  id: string;
  targetType: FlagTarget;
  targetId: string;
  kind: string;
  label: string;
  link: string;
  score: number;
  signals: string[];
  excerpt: string | null;
  hidden: boolean;
  createdAt: Date;
  author: { id: string; name: string; email: string; active: boolean; joined: Date; openFlags: number };
};

/** Open flags, riskiest first, with what was found and who wrote it. */
export async function riskQueue(member: Member): Promise<QueueItem[]> {
  await requireStaff(member);
  const parts = (Object.keys(CONTENT) as FlagTarget[]).map((type) => {
    const c = CONTENT[type];
    return `SELECT '${type}'::text AS type, t.${c.id} AS target_id, ${c.label} AS label, ${c.link} AS link, t.hidden_at IS NOT NULL AS hidden FROM ${c.table} t`;
  });
  const rows = await db.execute<{
    id: string;
    target_type: FlagTarget;
    target_id: string;
    label: string | null;
    link: string | null;
    hidden: boolean | null;
    score: number;
    signals: string[];
    excerpt: string | null;
    created_at: Date;
    author_id: string;
    author_name: string;
    author_email: string;
    author_active: boolean;
    author_joined: Date;
    open_flags: number;
  }>(sql`
    SELECT f.id, f.target_type, f.target_id, x.label, x.link, x.hidden, f.score, f.signals, f.excerpt, f.created_at,
           u.id AS author_id, u.name AS author_name, u.email AS author_email, u.active AS author_active, u.created_at AS author_joined,
           (SELECT count(*)::int FROM risk_flags g WHERE g.author_id = f.author_id AND g.status = 'OPEN') AS open_flags
    FROM risk_flags f
    JOIN users u ON u.id = f.author_id
    LEFT JOIN (${sql.raw(parts.join(" UNION ALL "))}) x ON x.type = f.target_type AND x.target_id = f.target_id
    WHERE f.status = 'OPEN'
    ORDER BY f.score DESC, f.created_at DESC
    LIMIT 200`);
  return rows.rows.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    kind: CONTENT[r.target_type].kind,
    label: r.label ?? "(deleted)",
    link: r.link ?? "#",
    score: r.score,
    signals: r.signals,
    excerpt: r.excerpt,
    hidden: !!r.hidden,
    createdAt: new Date(r.created_at),
    author: { id: r.author_id, name: r.author_name, email: r.author_email, active: r.author_active, joined: new Date(r.author_joined), openFlags: r.open_flags },
  }));
}

async function loadFlag(flagId: string) {
  if (!validId(flagId)) throw new ServiceError("Flag not found.");
  const [f] = await db.select().from(riskFlags).where(eq(riskFlags.id, flagId));
  if (!f) throw new ServiceError("Flag not found.");
  if (f.status !== "OPEN") throw new ServiceError("Someone already dealt with this flag.");
  return f;
}

async function closeFlags(staff: Member, where: ReturnType<typeof and>, status: "CLEARED" | "ACTIONED") {
  await db
    .update(riskFlags)
    .set({ status, reviewedBy: staff.id, reviewedAt: new Date() })
    .where(and(eq(riskFlags.status, "OPEN"), where));
}

/** Not a problem: the flag closes and the content stays (a held job is approved). */
export async function clearFlag(member: Member, flagId: string) {
  const staff = await requireStaff(member);
  const f = await loadFlag(flagId);
  await closeFlags(staff, eq(riskFlags.id, f.id), "CLEARED");
  if (f.targetType === "JOB") await db.update(communityJobs).set({ heldAt: null, heldReason: null }).where(eq(communityJobs.id, f.targetId));
  await audit(staff, f.targetType === "JOB" ? "JOB_APPROVED" : "FLAG_CLEARED", "CONTENT", f.targetId, `${CONTENT[f.targetType as FlagTarget].kind} by ${await nameOf(f.authorId)}`);
}

async function hideContent(staff: Member, type: FlagTarget, targetId: string, reason: string) {
  const c = CONTENT[type];
  await db.execute(sql`
    UPDATE ${sql.raw(c.table)} SET hidden_at = now(), hidden_by = ${staff.id}, hidden_reason = ${reason}
    WHERE ${sql.raw(c.id)} = ${targetId} AND hidden_at IS NULL`);
}

/** Hides the flagged content (organizers can show it again on its page). */
export async function hideFlagged(member: Member, flagId: string, rawReason: string) {
  const staff = await requireStaff(member);
  const reason = reasonInput.parse(rawReason);
  const f = await loadFlag(flagId);
  await hideContent(staff, f.targetType as FlagTarget, f.targetId, reason);
  await closeFlags(staff, eq(riskFlags.id, f.id), "ACTIONED");
  await audit(staff, "CONTENT_HIDDEN", "CONTENT", f.targetId, `${CONTENT[f.targetType as FlagTarget].kind} by ${await nameOf(f.authorId)}`, reason);
}

async function nameOf(userId: string) {
  const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  return u ? `${u.name} <${u.email}>` : "unknown";
}

// --- Held jobs -------------------------------------------------------------------------------

export type HeldJob = { id: string; title: string; hirer: string; heldAt: Date; posterId: string; posterName: string; flagId: string | null; signals: string[]; score: number | null };

export async function heldJobs(member: Member): Promise<HeldJob[]> {
  await requireStaff(member);
  const rows = await db
    .select({
      id: communityJobs.id,
      title: communityJobs.title,
      hirer: communityJobs.hirer,
      heldAt: communityJobs.heldAt,
      posterId: communityJobs.posterId,
      posterName: users.name,
      flagId: riskFlags.id,
      signals: riskFlags.signals,
      score: riskFlags.score,
    })
    .from(communityJobs)
    .innerJoin(users, eq(users.id, communityJobs.posterId))
    .leftJoin(riskFlags, and(eq(riskFlags.targetType, "JOB"), eq(riskFlags.targetId, communityJobs.id)))
    .where(and(isNotNull(communityJobs.heldAt), isNull(communityJobs.hiddenAt)))
    .orderBy(communityJobs.heldAt);
  return rows.map((r) => ({ ...r, heldAt: r.heldAt!, signals: r.signals ?? [] }));
}

// --- People ----------------------------------------------------------------------------------

/**
 * Blocks the login (signed out everywhere) and hides everything they posted: profile, jobs, chat,
 * articles, comments, projects, feedback, tools, team posts and sessions. Returns how much was hidden.
 */
export async function banAndCleanUp(member: Member, userId: string, rawReason: string): Promise<number> {
  const staff = await requireStaff(member);
  const reason = reasonInput.parse(rawReason);
  if (!validId(userId)) throw new ServiceError("Person not found.");
  const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, userId));
  if (!u) throw new ServiceError("Person not found.");
  // The same checks as blocking (not yourself, not staff); an already-blocked login is just cleaned up.
  if (u.active) await setLoginBlocked(staff, userId, true, reason);
  let hidden = 0;
  await db.transaction(async (tx) => {
    for (const t of CLEANUP) {
      const r = await tx.execute(sql`
        UPDATE ${sql.raw(t.table)} SET hidden_at = now(), hidden_by = ${staff.id}, hidden_reason = ${reason}
        WHERE ${sql.raw(t.author)} = ${userId} AND hidden_at IS NULL`);
      hidden += r.rowCount ?? 0;
    }
  });
  await closeFlags(staff, eq(riskFlags.authorId, userId), "ACTIONED");
  await audit(staff, "BANNED_AND_CLEANED", "USER", userId, `${await nameOf(userId)}: ${hidden} item(s) hidden`, reason);
  return hidden;
}

/** Lifts the new-account limits early for someone staff know (or puts them back). */
export async function setTrusted(member: Member, userId: string, trusted: boolean) {
  const staff = await requireStaff(member);
  if (!validId(userId)) throw new ServiceError("Person not found.");
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw new ServiceError("Person not found.");
  await ensureProfile(u);
  await db.update(memberProfiles).set({ trustedAt: trusted ? new Date() : null }).where(eq(memberProfiles.userId, userId));
  await audit(staff, trusted ? "LIMITS_LIFTED" : "LIMITS_RESTORED", "USER", userId, `${u.name} <${u.email}>`);
}

export type SafetyProfile = { standing: Standing; trustedAt: Date | null; flags: { open: number; total: number }; recent: QueueItem[] };

/** For a person's page: their standing under the new-account limits and their flags. */
export async function safetyProfile(member: Member, userId: string): Promise<SafetyProfile | null> {
  await requireStaff(member);
  if (!validId(userId)) return null;
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) return null;
  const [p] = await db.select({ trustedAt: memberProfiles.trustedAt }).from(memberProfiles).where(eq(memberProfiles.userId, userId));
  const [counts] = (
    await db.execute<{ open: number; total: number }>(sql`SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*)::int AS total FROM risk_flags WHERE author_id = ${userId}`)
  ).rows;
  const recent = (await riskQueue(member)).filter((q) => q.author.id === userId).slice(0, 10);
  return { standing: await standing(u), trustedAt: p?.trustedAt ?? null, flags: counts, recent };
}

/** Counts for the console header and overview. */
export async function safetyCounts(member: Member): Promise<{ openFlags: number; heldJobs: number }> {
  await requireStaff(member);
  const [r] = (
    await db.execute<{ open_flags: number; held_jobs: number }>(sql`
      SELECT (SELECT count(*)::int FROM risk_flags WHERE status = 'OPEN') AS open_flags,
             (SELECT count(*)::int FROM community_jobs WHERE held_at IS NOT NULL AND hidden_at IS NULL) AS held_jobs`)
  ).rows;
  return { openFlags: r.open_flags, heldJobs: r.held_jobs };
}

