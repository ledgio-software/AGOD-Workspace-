import { and, asc, count, desc, eq, gt, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communitySessionAttendees, communitySessions, memberProfiles, users } from "@/lib/db/schema";
import { formatDateTime, zonedTime } from "@/lib/dates";
import { icsEvent } from "@/lib/ics";
import { appUrl, sendAccountEmail } from "@/modules/accounts";
import { sessionChangedMessage, sessionJoinedMessage, sessionReminderMessage } from "@/modules/email/account";
import { ServiceError } from "@/modules/errors";
import { type Member, ensureProfile, fileReport, isOrganizer, reportInput } from "./index";

// Phase 27: teaching sessions (handbook: "Sessions are where experienced developers teach how to
// code and how to use AI tools, live and in a group"). Reviewers and organizers host; members join.
// The call runs on Google Meet, Zoom or Discord; its link is only shown to the host, the people who
// joined and organizers (it is never on the public page). Joining sends a confirmation with a
// calendar file; the daily job sends a reminder on the day; changes and cancellations are emailed.

export const LEVELS = { BEGINNER: "Beginners", INTERMEDIATE: "Some experience", ALL: "Everyone" } as const;
export type Level = keyof typeof LEVELS;

const UPCOMING_PER_HOST = 5;
const id = /^[0-9a-f-]{36}$/i;

/** Where the call happens, for its label. */
export function callProvider(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  if (/^meet\.google\.com$/.test(host)) return "Google Meet";
  if (/(^|\.)zoom\.us$/.test(host)) return "Zoom";
  if (/(^|\.)discord\.(gg|com)$/.test(host)) return "Discord";
  if (/(^|\.)teams\.microsoft\.com$|^teams\.live\.com$/.test(host)) return "Microsoft Teams";
  return "the call";
}

const link = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : /^https?:\/\//i.test(v) ? v.replace(/^http:\/\//i, "https://") : `https://${v}`))
  .refine((v) => v === null || /^https:\/\/[^\s/]+\.[^\s]+$/.test(v), "Enter a web address such as https://meet.google.com/abc-defg-hij");

export const sessionInput = z.object({
  title: z.string().trim().min(3, "Give the session a title").max(120),
  description: z.string().trim().min(10, "Say what people will learn (at least 10 characters)").max(3000),
  level: z.enum(["BEGINNER", "INTERMEDIATE", "ALL"]),
  topics: z
    .string()
    .max(300)
    .transform((v) => [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))])
    .refine((l) => l.length <= 8 && l.every((t) => t.length <= 30), "Topics: up to 8, each at most 30 characters"),
  date: z.iso.date("Pick a date"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a start time"),
  durationMinutes: z.coerce.number().int().min(15, "15 minutes to 6 hours").max(360, "15 minutes to 6 hours"),
  callUrl: link.refine((v) => v !== null, "Add the call link (Google Meet, Zoom or Discord)"),
  capacity: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 2 && v <= 1000), "Seats: 2 to 1,000, or empty for no limit"),
});

export const recordingInput = z.object({
  recordingUrl: link,
  notes: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null),
});

async function profileOf(member: Member) {
  return ensureProfile(member);
}

/** Hosting is for members who agreed to the code of conduct and are Reviewers (or organizers). */
export async function hostingStatus(member: Member): Promise<{ allowed: boolean; reason: string | null }> {
  const profile = await profileOf(member);
  if (!profile.conductAcceptedAt) return { allowed: false, reason: "Agree to the code of conduct on the community home first." };
  if (!profile.reviewer && !isOrganizer(profile, member.email)) {
    return { allowed: false, reason: "Sessions are hosted by Reviewers: tick “I can review work and mentor” on your profile to host one." };
  }
  return { allowed: true, reason: null };
}

const times = (input: z.output<typeof sessionInput>) => {
  const startsAt = zonedTime(input.date, input.time);
  return { startsAt, endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000) };
};

const fields = (input: z.output<typeof sessionInput>) => ({
  title: input.title,
  description: input.description,
  level: input.level,
  topics: input.topics,
  callUrl: input.callUrl!,
  capacity: input.capacity,
  ...times(input),
});

export async function createSession(member: Member, raw: z.input<typeof sessionInput>) {
  const input = sessionInput.parse(raw);
  const status = await hostingStatus(member);
  if (!status.allowed) throw new ServiceError(status.reason!);
  const values = fields(input);
  if (values.startsAt.getTime() < Date.now() + 10 * 60_000) throw new ServiceError("Pick a time at least 10 minutes from now.");
  const [upcoming] = await db
    .select({ n: count() })
    .from(communitySessions)
    .where(and(eq(communitySessions.hostId, member.id), isNull(communitySessions.cancelledAt), gt(communitySessions.endsAt, new Date())));
  if (upcoming.n >= UPCOMING_PER_HOST) throw new ServiceError(`You already have ${UPCOMING_PER_HOST} upcoming sessions. Hold one before scheduling more.`);
  const [session] = await db.insert(communitySessions).values({ ...values, hostId: member.id }).returning();
  return session;
}

async function loadSession(sessionId: string) {
  if (!id.test(sessionId)) return null;
  const [row] = await db.select().from(communitySessions).where(eq(communitySessions.id, sessionId));
  return row ?? null;
}

async function ownSession(member: Member, sessionId: string) {
  const session = await loadSession(sessionId);
  if (!session || session.hostId !== member.id) throw new ServiceError("Session not found.");
  return session;
}

const whenText = (s: { startsAt: Date; endsAt: Date }) => `${formatDateTime(s.startsAt)} to ${new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: process.env.APP_TIMEZONE ?? "Africa/Accra" }).format(s.endsAt)}`;
const pageUrl = (sessionId: string) => appUrl(`/sessions/${sessionId}`);

export function sessionIcs(s: { id: string; title: string; description: string; startsAt: Date; endsAt: Date; callUrl: string | null; cancelledAt?: Date | null }) {
  return icsEvent({
    uid: `${s.id}@sessions.gvcd`,
    title: s.title,
    description: `${s.description}\n\n${pageUrl(s.id)}`,
    start: s.startsAt,
    end: s.endsAt,
    url: pageUrl(s.id),
    location: s.callUrl ?? undefined,
    cancelled: !!s.cancelledAt,
  });
}

const icsAttachment = (s: Parameters<typeof sessionIcs>[0]) => ({ filename: "session.ics", content: new TextEncoder().encode(sessionIcs(s)), contentType: "text/calendar; charset=utf-8" });

async function attendeesOf(sessionId: string) {
  return db
    .select({ userId: users.id, name: users.name, email: users.email, handle: memberProfiles.handle })
    .from(communitySessionAttendees)
    .innerJoin(users, eq(users.id, communitySessionAttendees.userId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
    .where(and(eq(communitySessionAttendees.sessionId, sessionId), eq(users.active, true)))
    .orderBy(asc(communitySessionAttendees.createdAt));
}

/** Emails everyone who joined (failures are logged; the change itself stands). */
async function tellAttendees(session: typeof communitySessions.$inferSelect, cancelled: boolean) {
  for (const a of await attendeesOf(session.id)) {
    await sendAccountEmail(a.email, {
      ...sessionChangedMessage({ name: a.name, title: session.title, when: whenText(session), callUrl: cancelled ? null : session.callUrl, url: pageUrl(session.id), cancelled, reason: session.cancelReason }),
      attachments: [icsAttachment(session)],
    }).catch((error) => console.error("Session email failed", session.id, error instanceof Error ? error.message : error));
  }
}

/** The host: changes an upcoming session; people who joined are told when the time or link changes. */
export async function updateSession(member: Member, sessionId: string, raw: z.input<typeof sessionInput>) {
  const input = sessionInput.parse(raw);
  const before = await ownSession(member, sessionId);
  if (before.cancelledAt) throw new ServiceError("This session was cancelled.");
  if (before.endsAt.getTime() <= Date.now()) throw new ServiceError("This session is over. Add the recording instead.");
  const values = fields(input);
  if (values.startsAt.getTime() !== before.startsAt.getTime() && values.startsAt.getTime() < Date.now()) throw new ServiceError("Pick a time in the future.");
  const [joined] = await db.select({ n: count() }).from(communitySessionAttendees).where(eq(communitySessionAttendees.sessionId, sessionId));
  if (values.capacity !== null && values.capacity < joined.n) throw new ServiceError(`${joined.n} people already joined: allow at least ${joined.n} seats.`);
  const [after] = await db.update(communitySessions).set(values).where(eq(communitySessions.id, sessionId)).returning();
  const changed = before.startsAt.getTime() !== after.startsAt.getTime() || before.endsAt.getTime() !== after.endsAt.getTime() || before.callUrl !== after.callUrl;
  if (changed) {
    // A new time deserves a new reminder.
    await db.update(communitySessionAttendees).set({ remindedAt: null }).where(eq(communitySessionAttendees.sessionId, sessionId));
    await tellAttendees(after, false);
  }
  return after;
}

export const cancelInput = z.object({ reason: z.string().trim().min(3, "Say briefly why (people who joined are told)").max(300) });

/** The host or an organizer: cancels an upcoming session; people who joined are told. */
export async function cancelSession(member: Member, sessionId: string, raw: z.input<typeof cancelInput>) {
  const input = cancelInput.parse(raw);
  const session = await loadSession(sessionId);
  const organizer = isOrganizer(await profileOf(member), member.email);
  if (!session || (session.hostId !== member.id && !organizer)) throw new ServiceError("Session not found.");
  if (session.cancelledAt) throw new ServiceError("This session was already cancelled.");
  if (session.endsAt.getTime() <= Date.now()) throw new ServiceError("This session is over.");
  const [cancelled] = await db
    .update(communitySessions)
    .set({ cancelledAt: new Date(), cancelReason: input.reason })
    .where(eq(communitySessions.id, sessionId))
    .returning();
  await tellAttendees(cancelled, true);
}

/** The host, once it has started: the recording link and key notes for people who missed it. */
export async function addRecording(member: Member, sessionId: string, raw: z.input<typeof recordingInput>) {
  const input = recordingInput.parse(raw);
  const session = await ownSession(member, sessionId);
  if (session.cancelledAt) throw new ServiceError("This session was cancelled.");
  if (session.startsAt.getTime() > Date.now()) throw new ServiceError("Add the recording once the session has started.");
  if (!input.recordingUrl && !input.notes) throw new ServiceError("Add a recording link or some notes.");
  await db.update(communitySessions).set(input).where(eq(communitySessions.id, sessionId));
}

// --- Joining --------------------------------------------------------------------------------

/** Any member who agreed to the code of conduct: takes a seat and gets a confirmation email. */
export async function joinSession(member: Member, sessionId: string) {
  const profile = await profileOf(member);
  if (!profile.conductAcceptedAt) throw new ServiceError("Agree to the code of conduct on the community home first.");
  if (!id.test(sessionId)) throw new ServiceError("Session not found.");
  const session = await db.transaction(async (tx) => {
    // The row lock keeps two people from taking the last seat at once.
    const [s] = await tx.select().from(communitySessions).where(eq(communitySessions.id, sessionId)).for("update");
    if (!s || s.hiddenAt) throw new ServiceError("Session not found.");
    if (s.hostId === member.id) throw new ServiceError("You're hosting this session.");
    if (s.cancelledAt) throw new ServiceError("This session was cancelled.");
    if (s.endsAt.getTime() <= Date.now()) throw new ServiceError("This session is over.");
    const [joined] = await tx.select({ n: count() }).from(communitySessionAttendees).where(eq(communitySessionAttendees.sessionId, sessionId));
    if (s.capacity !== null && joined.n >= s.capacity) throw new ServiceError("This session is full.");
    const [row] = await tx.insert(communitySessionAttendees).values({ sessionId, userId: member.id }).onConflictDoNothing().returning();
    if (!row) throw new ServiceError("You already joined this session.");
    return s;
  });
  const [host] = await db.select({ name: users.name }).from(users).where(eq(users.id, session.hostId));
  await sendAccountEmail(member.email, {
    ...sessionJoinedMessage({ name: member.name, title: session.title, when: whenText(session), host: host.name, callUrl: session.callUrl, url: pageUrl(session.id) }),
    attachments: [icsAttachment(session)],
  }).catch((error) => console.error("Session confirmation email failed", session.id, error instanceof Error ? error.message : error));
  return session;
}

/** Gives the seat back (before the session ends). */
export async function leaveSession(member: Member, sessionId: string) {
  const session = await loadSession(sessionId);
  if (!session) throw new ServiceError("Session not found.");
  if (session.endsAt.getTime() <= Date.now()) throw new ServiceError("This session is over.");
  const removed = await db
    .delete(communitySessionAttendees)
    .where(and(eq(communitySessionAttendees.sessionId, sessionId), eq(communitySessionAttendees.userId, member.id)))
    .returning({ id: communitySessionAttendees.id });
  if (removed.length === 0) throw new ServiceError("You haven't joined this session.");
}

// --- Reading --------------------------------------------------------------------------------

const attendeeCount = sql<number>`(SELECT count(*)::int FROM community_session_attendees a WHERE a.session_id = ${communitySessions.id})`;

const cardFields = {
  id: communitySessions.id,
  title: communitySessions.title,
  level: communitySessions.level,
  topics: communitySessions.topics,
  startsAt: communitySessions.startsAt,
  endsAt: communitySessions.endsAt,
  capacity: communitySessions.capacity,
  recordingUrl: communitySessions.recordingUrl,
  hasNotes: sql<boolean>`${communitySessions.notes} IS NOT NULL`,
  hostName: users.name,
  hostHandle: memberProfiles.handle,
  attendees: attendeeCount,
};
export type SessionCard = {
  id: string;
  title: string;
  level: string;
  topics: string[];
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  recordingUrl: string | null;
  hasNotes: boolean;
  hostName: string;
  hostHandle: string | null;
  attendees: number;
};

const listable = and(isNull(communitySessions.hiddenAt), isNull(communitySessions.cancelledAt), eq(users.active, true));

/** Upcoming (soonest first) or past (newest first, the recordings archive). */
export async function listSessions(when: "upcoming" | "past", o: { limit?: number; page?: number; hostId?: string; q?: string } = {}) {
  const now = new Date();
  const q = o.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const limit = Math.min(o.limit ?? 30, 60);
  const page = Math.max(1, Math.min(o.page ?? 1, 1000));
  const rows = await db
    .select(cardFields)
    .from(communitySessions)
    .innerJoin(users, eq(users.id, communitySessions.hostId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, communitySessions.hostId))
    .where(and(listable, when === "upcoming" ? gt(communitySessions.endsAt, now) : lte(communitySessions.endsAt, now), o.hostId ? eq(communitySessions.hostId, o.hostId) : undefined, like ? or(ilike(communitySessions.title, like), ilike(communitySessions.description, like), sql`array_to_string(${communitySessions.topics}, ' ') ILIKE ${like}`) : undefined))
    .orderBy(when === "upcoming" ? asc(communitySessions.startsAt) : desc(communitySessions.startsAt))
    .limit(limit + 1)
    .offset((page - 1) * limit);
  return { sessions: rows.slice(0, limit) as SessionCard[], more: rows.length > limit, page };
}

/** Upcoming sessions the member hosts or joined. */
export async function mySessions(member: Member) {
  const joined = db.select({ id: communitySessionAttendees.sessionId }).from(communitySessionAttendees).where(eq(communitySessionAttendees.userId, member.id));
  const rows = await db
    .select(cardFields)
    .from(communitySessions)
    .innerJoin(users, eq(users.id, communitySessions.hostId))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, communitySessions.hostId))
    .where(and(listable, gt(communitySessions.endsAt, new Date()), sql`(${communitySessions.hostId} = ${member.id} OR ${communitySessions.id} IN (${joined}))`))
    .orderBy(asc(communitySessions.startsAt))
    .limit(10);
  return rows as SessionCard[];
}

/** Sessions the member joined or hosted, ever (for the getting-started checklist). */
export async function sessionsTakenPart(member: Member) {
  const [joined] = await db.select({ n: count() }).from(communitySessionAttendees).where(eq(communitySessionAttendees.userId, member.id));
  const [hosted] = await db.select({ n: count() }).from(communitySessions).where(and(eq(communitySessions.hostId, member.id), isNull(communitySessions.cancelledAt)));
  return { joined: joined.n, hosted: hosted.n };
}

/**
 * A session page. Null when it doesn't exist or is hidden (except for its host and organizers).
 * The call link is only included for the host, people who joined and organizers.
 */
export async function getSession(sessionId: string, viewer: Member | null) {
  const session = await loadSession(sessionId);
  if (!session) return null;
  const [host] = await db
    .select({ name: users.name, handle: memberProfiles.handle, active: users.active })
    .from(users)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
    .where(eq(users.id, session.hostId));
  const self = viewer?.id === session.hostId;
  const organizer = viewer ? isOrganizer((await db.select().from(memberProfiles).where(eq(memberProfiles.userId, viewer.id)))[0] ?? null, viewer.email) : false;
  if ((session.hiddenAt || !host.active) && !self && !organizer) return null;
  const attendees = await attendeesOf(session.id);
  const joined = !!viewer && attendees.some((a) => a.userId === viewer.id);
  const now = Date.now();
  return {
    session: { ...session, callUrl: self || joined || organizer ? session.callUrl : null },
    host: { name: host.name, handle: host.handle },
    // Names only: emails stay private.
    attendees: attendees.map((a) => ({ userId: a.userId, name: a.name, handle: a.handle })),
    self,
    organizer,
    joined,
    full: session.capacity !== null && attendees.length >= session.capacity,
    state: session.cancelledAt ? ("cancelled" as const) : now >= session.endsAt.getTime() ? ("past" as const) : now >= session.startsAt.getTime() ? ("live" as const) : ("upcoming" as const),
    provider: callProvider(session.callUrl),
  };
}

// --- Reminders (daily job) ------------------------------------------------------------------

/** Emails people who joined sessions starting in the next 24 hours (once each). */
export async function sendSessionReminders(now = new Date()) {
  const soon = await db
    .select({ attendeeId: communitySessionAttendees.id, session: communitySessions, name: users.name, email: users.email })
    .from(communitySessionAttendees)
    .innerJoin(communitySessions, eq(communitySessions.id, communitySessionAttendees.sessionId))
    .innerJoin(users, eq(users.id, communitySessionAttendees.userId))
    .where(
      and(
        isNull(communitySessionAttendees.remindedAt),
        isNull(communitySessions.cancelledAt),
        isNull(communitySessions.hiddenAt),
        gte(communitySessions.startsAt, now),
        lte(communitySessions.startsAt, new Date(now.getTime() + 24 * 3_600_000)),
        eq(users.active, true),
      ),
    );
  let sent = 0;
  let failed = 0;
  for (const row of soon) {
    try {
      const ok = await sendAccountEmail(row.email, sessionReminderMessage({ name: row.name, title: row.session.title, when: whenText(row.session), callUrl: row.session.callUrl, url: pageUrl(row.session.id) }));
      if (!ok) continue; // email isn't set up here
      await db.update(communitySessionAttendees).set({ remindedAt: new Date() }).where(eq(communitySessionAttendees.id, row.attendeeId));
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Session reminder failed", row.session.id, error instanceof Error ? error.message : error);
    }
  }
  return { sent, failed };
}

// --- Moderation -----------------------------------------------------------------------------

export async function reportSession(member: Member, sessionId: string, raw: z.input<typeof reportInput>) {
  const session = await loadSession(sessionId);
  if (!session || session.hiddenAt) throw new ServiceError("Session not found.");
  if (session.hostId === member.id) throw new ServiceError("You can't report your own session.");
  return fileReport(member, "SESSION", session.id, raw);
}

export async function unhideSession(member: Member, sessionId: string) {
  if (!isOrganizer(await profileOf(member), member.email)) throw new ServiceError("Only community organizers can do that.");
  if (!id.test(sessionId)) throw new ServiceError("Session not found.");
  await db.update(communitySessions).set({ hiddenAt: null, hiddenBy: null, hiddenReason: null }).where(eq(communitySessions.id, sessionId));
}

