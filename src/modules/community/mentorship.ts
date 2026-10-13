import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { memberProfiles, mentorships, users } from "@/lib/db/schema";
import { appUrl, sendAccountEmail } from "@/modules/accounts";
import { mentorAnswerMessage, mentorRequestMessage } from "@/modules/email/account";
import { ServiceError } from "@/modules/errors";
import { type Member, ensureProfile } from "./index";
import { requireEstablished } from "@/modules/safety/screen";

// Phase 31: mentorship matching. Reviewers can open themselves to mentoring (for 1 to 5 people at
// a time, with a note on what they help with). Members see suggested mentors (shared tools first,
// then the same city) and ask one with a goal; the mentor accepts or declines. Once accepted, both
// see each other's email address to arrange how they meet. Either can end it.

const OPEN = ["PENDING", "ACTIVE"] as const;
/** How many mentors a member can be asking or working with at once. */
export const MAX_OPEN_AS_MENTEE = 2;

export const mentorSettingsInput = z.object({
  open: z.boolean(),
  capacity: z.coerce.number().int().min(1, "1 to 5 people").max(5, "1 to 5 people"),
  note: z
    .string()
    .trim()
    .max(300, "What you can help with: at most 300 characters")
    .transform((v) => v || null),
});

export async function updateMentorSettings(member: Member, raw: z.input<typeof mentorSettingsInput>) {
  const input = mentorSettingsInput.parse(raw);
  const profile = await ensureProfile(member);
  if (input.open && !profile.reviewer) throw new ServiceError("Tick the Reviewer badge on your profile first: mentors are Reviewers.");
  if (input.open && !profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
  await db.update(memberProfiles).set({ mentorOpen: input.open, mentorCapacity: input.capacity, mentorNote: input.note }).where(eq(memberProfiles.userId, member.id));
}

async function activeCounts(mentorIds: string[]) {
  if (mentorIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ mentorId: mentorships.mentorId, n: sql<number>`count(*)::int` })
    .from(mentorships)
    .where(and(inArray(mentorships.mentorId, mentorIds), eq(mentorships.status, "ACTIVE")))
    .groupBy(mentorships.mentorId);
  return new Map(rows.map((r) => [r.mentorId, r.n]));
}

export type MentorCard = {
  userId: string;
  name: string;
  handle: string;
  headline: string | null;
  city: string | null;
  tools: string[];
  note: string | null;
  capacity: number;
  active: number;
  hasSpace: boolean;
  sharedTools: string[];
  sameCity: boolean;
};

const lower = (list: string[]) => list.map((t) => t.toLowerCase());

/**
 * Mentors, best match first for the viewer: those with space, then shared tools (two points each)
 * and the same city (one point), then newest. Visitors see public mentor profiles only.
 */
export async function listMentors(viewer: Member | null, filters: { q?: string } = {}): Promise<MentorCard[]> {
  const q = filters.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db
    .select({
      userId: memberProfiles.userId,
      name: users.name,
      handle: memberProfiles.handle,
      headline: memberProfiles.headline,
      city: memberProfiles.city,
      tools: memberProfiles.tools,
      note: memberProfiles.mentorNote,
      capacity: memberProfiles.mentorCapacity,
    })
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(
      and(
        eq(memberProfiles.mentorOpen, true),
        eq(memberProfiles.reviewer, true),
        isNull(memberProfiles.hiddenAt),
        eq(users.active, true),
        viewer ? undefined : eq(memberProfiles.visibility, "PUBLIC"),
        like
          ? or(
              sql`${users.name} ILIKE ${like}`,
              sql`${memberProfiles.headline} ILIKE ${like}`,
              sql`${memberProfiles.mentorNote} ILIKE ${like}`,
              sql`array_to_string(${memberProfiles.tools}, ' ') ILIKE ${like}`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(memberProfiles.createdAt))
    .limit(200);
  const me = viewer ? (await db.select({ tools: memberProfiles.tools, city: memberProfiles.city }).from(memberProfiles).where(eq(memberProfiles.userId, viewer.id)))[0] : null;
  const myTools = new Set(lower(me?.tools ?? []));
  const myCity = me?.city?.trim().toLowerCase() || null;
  const active = await activeCounts(rows.map((r) => r.userId));
  return rows
    .filter((r) => r.userId !== viewer?.id)
    .map((r) => {
      const sharedTools = r.tools.filter((t) => myTools.has(t.toLowerCase()));
      const n = active.get(r.userId) ?? 0;
      return { ...r, active: n, hasSpace: n < r.capacity, sharedTools, sameCity: !!myCity && r.city?.trim().toLowerCase() === myCity };
    })
    .sort((a, b) => Number(b.hasSpace) - Number(a.hasSpace) || b.sharedTools.length * 2 + Number(b.sameCity) - (a.sharedTools.length * 2 + Number(a.sameCity)));
}

export const requestInput = z.object({
  goal: z.string().trim().min(10, "Say what you want help with (at least 10 characters)").max(500, "At most 500 characters"),
});

/** A member asks a mentor (by profile address) for help with a goal. */
export async function requestMentor(member: Member, mentorHandle: string, raw: z.input<typeof requestInput>) {
  const input = requestInput.parse(raw);
  const profile = await ensureProfile(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
  // Phase 41: new accounts wait a few days before contacting mentors.
  await requireEstablished(member, "Asking for a mentor");
  const [mentor] = await db
    .select({ userId: memberProfiles.userId, open: memberProfiles.mentorOpen, capacity: memberProfiles.mentorCapacity, hiddenAt: memberProfiles.hiddenAt, name: users.name, email: users.email, active: users.active })
    .from(memberProfiles)
    .innerJoin(users, eq(users.id, memberProfiles.userId))
    .where(eq(memberProfiles.handle, mentorHandle));
  if (!mentor || !mentor.open || mentor.hiddenAt || !mentor.active) throw new ServiceError("This member isn't taking mentees right now.");
  if (mentor.userId === member.id) throw new ServiceError("You can't mentor yourself.");
  const id = await db.transaction(async (tx) => {
    // One request at a time per member and mentor (serialised per mentee).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mentee:' || ${member.id}))`);
    const mine = await tx.select({ mentorId: mentorships.mentorId }).from(mentorships).where(and(eq(mentorships.menteeId, member.id), inArray(mentorships.status, [...OPEN])));
    if (mine.some((m) => m.mentorId === mentor.userId)) throw new ServiceError("You already asked this mentor.");
    if (mine.length >= MAX_OPEN_AS_MENTEE) throw new ServiceError(`You can ask or work with ${MAX_OPEN_AS_MENTEE} mentors at a time. Withdraw or end one first.`);
    const active = (await activeCounts([mentor.userId])).get(mentor.userId) ?? 0;
    if (active >= mentor.capacity) throw new ServiceError("This mentor has no space right now. Try another one.");
    const [row] = await tx.insert(mentorships).values({ mentorId: mentor.userId, menteeId: member.id, goal: input.goal }).returning({ id: mentorships.id });
    if (!profile.wantsMentor) await tx.update(memberProfiles).set({ wantsMentor: true }).where(eq(memberProfiles.userId, member.id));
    return row.id;
  });
  await sendAccountEmail(mentor.email, mentorRequestMessage({ name: mentor.name, mentee: member.name, goal: input.goal, url: appUrl("/community/mentoring") })).catch((error) =>
    console.error("Mentorship request email failed", id, error instanceof Error ? error.message : error),
  );
  return id;
}

export const answerInput = z.object({
  accept: z.boolean(),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null),
});

/** The mentor's answer. Accepting needs space; it shares both email addresses. */
export async function answerRequest(member: Member, mentorshipId: string, raw: z.input<typeof answerInput>) {
  const input = answerInput.parse(raw);
  const result = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(mentorships).where(eq(mentorships.id, mentorshipId)).for("update");
    if (!m || m.mentorId !== member.id) throw new ServiceError("Request not found.");
    if (m.status !== "PENDING") throw new ServiceError("This request has already been answered.");
    if (input.accept) {
      const [p] = await tx.select({ capacity: memberProfiles.mentorCapacity }).from(memberProfiles).where(eq(memberProfiles.userId, member.id));
      const active = (await activeCounts([member.id])).get(member.id) ?? 0;
      if (active >= (p?.capacity ?? 0)) throw new ServiceError("You're already mentoring as many people as you said you could. End one, or raise your number.");
    }
    await tx
      .update(mentorships)
      .set({ status: input.accept ? "ACTIVE" : "DECLINED", responseNote: input.note, respondedAt: new Date() })
      .where(eq(mentorships.id, mentorshipId));
    return m;
  });
  const [mentee] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, result.menteeId));
  await sendAccountEmail(
    mentee.email,
    mentorAnswerMessage({ name: mentee.name, mentor: member.name, accepted: input.accept, note: input.note, mentorEmail: input.accept ? member.email : null, url: appUrl("/community/mentoring") }),
  ).catch((error) => console.error("Mentorship answer email failed", mentorshipId, error instanceof Error ? error.message : error));
}

/** The mentee takes back a request the mentor hasn't answered. */
export async function withdrawRequest(member: Member, mentorshipId: string) {
  const [updated] = await db
    .update(mentorships)
    .set({ status: "WITHDRAWN", endedAt: new Date(), endedBy: member.id })
    .where(and(eq(mentorships.id, mentorshipId), eq(mentorships.menteeId, member.id), eq(mentorships.status, "PENDING")))
    .returning({ id: mentorships.id });
  if (!updated) throw new ServiceError("There's no open request to withdraw.");
}

/** Either side ends an active mentorship. */
export async function endMentorship(member: Member, mentorshipId: string) {
  const [updated] = await db
    .update(mentorships)
    .set({ status: "ENDED", endedAt: new Date(), endedBy: member.id })
    .where(and(eq(mentorships.id, mentorshipId), eq(mentorships.status, "ACTIVE"), or(eq(mentorships.mentorId, member.id), eq(mentorships.menteeId, member.id))))
    .returning({ id: mentorships.id });
  if (!updated) throw new ServiceError("There's no active mentorship to end.");
}

export type MentorshipView = {
  id: string;
  status: string;
  goal: string;
  responseNote: string | null;
  createdAt: Date;
  other: { name: string; handle: string | null; email: string | null };
};

/** My mentorships, as mentor and as mentee, newest first. Email addresses only once accepted. */
export async function myMentorships(member: Member): Promise<{ asMentor: MentorshipView[]; asMentee: MentorshipView[] }> {
  const rows = await db
    .select({ m: mentorships })
    .from(mentorships)
    .where(or(eq(mentorships.mentorId, member.id), eq(mentorships.menteeId, member.id)))
    .orderBy(desc(mentorships.createdAt))
    .limit(100);
  const ids = [...new Set(rows.flatMap((r) => [r.m.mentorId, r.m.menteeId]))];
  const people = ids.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, handle: memberProfiles.handle })
        .from(users)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
        .where(inArray(users.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const view = (m: typeof mentorships.$inferSelect, otherId: string): MentorshipView => {
    const o = byId.get(otherId)!;
    return { id: m.id, status: m.status, goal: m.goal, responseNote: m.responseNote, createdAt: m.createdAt, other: { name: o.name, handle: o.handle, email: m.status === "ACTIVE" ? o.email : null } };
  };
  return {
    asMentor: rows.filter((r) => r.m.mentorId === member.id).map((r) => view(r.m, r.m.menteeId)),
    asMentee: rows.filter((r) => r.m.menteeId === member.id).map((r) => view(r.m, r.m.mentorId)),
  };
}

/** For profiles: how many people someone has mentored (accepted, now or before). */
export async function mentoredCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mentorships)
    .where(and(eq(mentorships.mentorId, userId), inArray(mentorships.status, ["ACTIVE", "ENDED"])));
  return row?.n ?? 0;
}
