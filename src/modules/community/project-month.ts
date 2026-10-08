import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { memberProfiles, projectOfMonth, projectVotes, showcasePosts, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { ServiceError } from "@/modules/errors";
import { type Member, ensureProfile, isOrganizer } from "./index";

// Phase 31: project of the month. Each member has one vote a month for a showcase project (not
// their own) and can move it until the month ends. When a month is over, the project with the most
// votes becomes its project of the month (ties: the one that reached its count first); organizers
// can pick a different one, with a note. Months are in Accra time (GMT).

export const thisMonth = (now: Date = new Date()) => todayInOperatingZone(now).slice(0, 7);

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

const visiblePost = and(isNull(showcasePosts.removedAt), isNull(showcasePosts.hiddenAt));

/** Votes for a project this month, or moves the vote to it; voting for the same one again takes the vote back. */
export async function voteForProject(member: Member, postId: string, now: Date = new Date()): Promise<"voted" | "moved" | "removed"> {
  const profile = await ensureProfile(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
  const [post] = await db.select({ authorId: showcasePosts.authorId }).from(showcasePosts).where(and(eq(showcasePosts.id, postId), visiblePost));
  if (!post) throw new ServiceError("Project not found.");
  if (post.authorId === member.id) throw new ServiceError("You can't vote for your own project.");
  const month = thisMonth(now);
  return db.transaction(async (tx) => {
    const [mine] = await tx.select().from(projectVotes).where(and(eq(projectVotes.voterId, member.id), eq(projectVotes.month, month))).for("update");
    if (mine?.postId === postId) {
      await tx.delete(projectVotes).where(eq(projectVotes.id, mine.id));
      return "removed";
    }
    if (mine) {
      await tx.update(projectVotes).set({ postId, createdAt: now }).where(eq(projectVotes.id, mine.id));
      return "moved";
    }
    await tx.insert(projectVotes).values({ postId, voterId: member.id, month, createdAt: now });
    return "voted";
  });
}

/** Which project I voted for this month, if any. */
export async function myVote(member: Member | null, now: Date = new Date()): Promise<string | null> {
  if (!member) return null;
  const [v] = await db.select({ postId: projectVotes.postId }).from(projectVotes).where(and(eq(projectVotes.voterId, member.id), eq(projectVotes.month, thisMonth(now))));
  return v?.postId ?? null;
}

export type Standing = { postId: string; title: string; authorName: string; votes: number };

/** The month's leading projects (visible ones only), most votes first; ties go to whoever got there first. */
export async function standings(month: string, limit = 10): Promise<Standing[]> {
  const rows = await db
    .select({
      postId: projectVotes.postId,
      title: showcasePosts.title,
      authorName: users.name,
      votes: sql<number>`count(*)::int`,
      reached: sql<Date>`max(${projectVotes.createdAt})`,
    })
    .from(projectVotes)
    .innerJoin(showcasePosts, eq(showcasePosts.id, projectVotes.postId))
    .innerJoin(users, eq(users.id, showcasePosts.authorId))
    .where(and(eq(projectVotes.month, month), visiblePost))
    .groupBy(projectVotes.postId, showcasePosts.title, users.name)
    .orderBy(desc(sql`count(*)`), asc(sql`max(${projectVotes.createdAt})`))
    .limit(limit);
  return rows.map((r) => ({ postId: r.postId, title: r.title, authorName: r.authorName, votes: r.votes }));
}

/** Vote counts for these projects this month (for the showcase cards). */
export async function votesThisMonth(postIds: string[], now: Date = new Date()): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();
  const rows = await db
    .select({ postId: projectVotes.postId, n: sql<number>`count(*)::int` })
    .from(projectVotes)
    .where(and(eq(projectVotes.month, thisMonth(now)), inArray(projectVotes.postId, postIds)))
    .groupBy(projectVotes.postId);
  return new Map(rows.map((r) => [r.postId, r.n]));
}

/**
 * Settles a finished month: the leading project becomes its project of the month (unless an
 * organizer already picked one). Safe to call again. Returns the winner's post id or null.
 */
export async function settleMonth(month: string, now: Date = new Date()): Promise<string | null> {
  if (month >= thisMonth(now)) return null;
  const [existing] = await db.select({ postId: projectOfMonth.postId }).from(projectOfMonth).where(eq(projectOfMonth.month, month));
  if (existing) return existing.postId;
  const [top] = await standings(month, 1);
  if (!top) return null;
  await db.insert(projectOfMonth).values({ month, postId: top.postId, votes: top.votes }).onConflictDoNothing();
  return top.postId;
}

export type Winner = { month: string; postId: string; title: string; pitch: string; authorName: string; votes: number; picked: boolean; note: string | null };

/** The most recent project of the month (last month's, settling it if needed). */
export async function latestProjectOfMonth(now: Date = new Date()): Promise<Winner | null> {
  await settleMonth(previousMonth(thisMonth(now)), now);
  const [row] = await db
    .select({
      month: projectOfMonth.month,
      postId: projectOfMonth.postId,
      votes: projectOfMonth.votes,
      pickedBy: projectOfMonth.pickedBy,
      note: projectOfMonth.note,
      title: showcasePosts.title,
      pitch: showcasePosts.pitch,
      authorName: users.name,
    })
    .from(projectOfMonth)
    .innerJoin(showcasePosts, eq(showcasePosts.id, projectOfMonth.postId))
    .innerJoin(users, eq(users.id, showcasePosts.authorId))
    .where(visiblePost)
    .orderBy(desc(projectOfMonth.month))
    .limit(1);
  if (!row) return null;
  const { pickedBy, ...rest } = row;
  return { ...rest, picked: pickedBy !== null };
}

/** Months each of these projects won (for a badge on the project). */
export async function monthsWon(postIds: string[]): Promise<Map<string, string[]>> {
  if (postIds.length === 0) return new Map();
  const rows = await db.select({ postId: projectOfMonth.postId, month: projectOfMonth.month }).from(projectOfMonth).where(inArray(projectOfMonth.postId, postIds));
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.postId, [...(map.get(r.postId) ?? []), r.month]);
  return map;
}

/** Organizers: choose a finished month's project of the month themselves (replaces the vote result). */
export async function pickProjectOfMonth(member: Member, month: string, postId: string, note: string | null, now: Date = new Date()) {
  const [p] = await db.select({ communityRole: memberProfiles.communityRole }).from(memberProfiles).where(eq(memberProfiles.userId, member.id));
  if (!isOrganizer(p ?? null, member.email)) throw new ServiceError("Only community organizers can do that.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= thisMonth(now)) throw new ServiceError("Pick for a month that has ended.");
  const [post] = await db.select({ id: showcasePosts.id }).from(showcasePosts).where(and(eq(showcasePosts.id, postId), visiblePost));
  if (!post) throw new ServiceError("Project not found.");
  const votes = (await standings(month, 100)).find((s) => s.postId === postId)?.votes ?? 0;
  const clean = note?.trim().slice(0, 500) || null;
  await db
    .insert(projectOfMonth)
    .values({ month, postId, votes, pickedBy: member.id, note: clean })
    .onConflictDoUpdate({ target: projectOfMonth.month, set: { postId, votes, pickedBy: member.id, note: clean } });
}
