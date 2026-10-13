import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { appeals, platformAudit, users } from "@/lib/db/schema";
import { appUrl, sendAccountEmail } from "@/modules/accounts";
import type { Member } from "@/modules/community";
import { appealDecisionMessage } from "@/modules/email/account";
import { ServiceError } from "@/modules/errors";
import { asStaff, setLoginBlocked } from "@/modules/platform";
import { HIDEABLE, type HideableType, isHideable } from "./content";

// Phase 42: appeals. Anyone can be wrongly caught by the scam check or a ban, so people can ask
// AGOD staff for a second look: a blocked login from the public /appeal form (the reply is the same
// whatever the email, so the form can't be used to find out who is blocked), and a hidden post from
// /community/appeals. Staff decide in the console; accepting restores the login or shows the post
// again, and the person is emailed either way. One open appeal per login or post at a time.

const messageInput = z.string().trim().min(20, "Tell us a bit more (at least 20 characters).").max(2000, "At most 2,000 characters.");
const noteInput = z.string().trim().min(5, "Add a short note (at least 5 characters); it goes in the back-office log and the email.").max(500, "Note: at most 500 characters");
const validId = (id: string) => z.uuid().safeParse(id).success;

/** After a rejected appeal, how long before the same login can appeal again. */
const RETRY_DAYS = 7;

/** Counts one use of a public form; true when this network used it more than max times in the window. */
export async function overLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - windowMs;
  const r = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, count, last_request) VALUES (${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.last_request < ${cutoff} THEN 1 ELSE rate_limits.count + 1 END,
      last_request = CASE WHEN rate_limits.last_request < ${cutoff} THEN ${now} ELSE rate_limits.last_request END
    RETURNING count`);
  return r.rows[0].count > max;
}

/**
 * A blocked login asking to be let back in. Always answers the same way; only an email that
 * belongs to a blocked login is stored, and only one open appeal per email.
 */
export async function submitAccountAppeal(input: { email: string; message: string }): Promise<void> {
  const email = z.email("Enter the email you sign in with.").parse(input.email.trim().toLowerCase());
  const message = messageInput.parse(input.message);
  const [u] = await db.select({ id: users.id, active: users.active }).from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!u || u.active) return;
  const since = new Date(Date.now() - RETRY_DAYS * 86_400_000);
  const [recent] = await db
    .select({ id: appeals.id })
    .from(appeals)
    .where(and(eq(appeals.kind, "ACCOUNT"), eq(appeals.userId, u.id), sql`(${appeals.status} = 'OPEN' OR ${appeals.decidedAt} > ${since})`))
    .limit(1);
  if (recent) return;
  await db.insert(appeals).values({ kind: "ACCOUNT", email, userId: u.id, message });
}

export type HiddenPost = {
  type: HideableType;
  id: string;
  kind: string;
  label: string;
  link: string;
  hiddenAt: Date;
  reason: string | null;
  appeal: { status: "OPEN" | "ACCEPTED" | "REJECTED"; note: string | null } | null;
};

/** What of this member's has been hidden, with the latest appeal on each. */
export async function myHiddenItems(member: Member): Promise<HiddenPost[]> {
  const parts = (Object.keys(HIDEABLE) as HideableType[]).map((type) => {
    const c = HIDEABLE[type];
    return sql`SELECT ${type}::text AS type, t.${sql.raw(c.id)} AS id, ${sql.raw(c.label)} AS label, ${sql.raw(c.link)} AS link, t.hidden_at, t.hidden_reason
      FROM ${sql.raw(c.table)} t WHERE t.${sql.raw(c.author)} = ${member.id} AND t.hidden_at IS NOT NULL`;
  });
  const rows = await db.execute<{ type: HideableType; id: string; label: string | null; link: string | null; hidden_at: Date; hidden_reason: string | null; status: string | null; note: string | null }>(sql`
    SELECT h.*, a.status, a.decision_note AS note
    FROM (${sql.join(parts, sql` UNION ALL `)}) h
    LEFT JOIN LATERAL (SELECT status, decision_note FROM appeals a WHERE a.target_type = h.type AND a.target_id = h.id ORDER BY a.created_at DESC LIMIT 1) a ON true
    ORDER BY h.hidden_at DESC
    LIMIT 100`);
  return rows.rows.map((r) => ({
    type: r.type,
    id: r.id,
    kind: HIDEABLE[r.type].kind,
    label: r.label ?? "(untitled)",
    link: r.link ?? "#",
    hiddenAt: new Date(r.hidden_at),
    reason: r.hidden_reason,
    appeal: r.status ? { status: r.status as "OPEN" | "ACCEPTED" | "REJECTED", note: r.note } : null,
  }));
}

/** A member asking for one of their hidden posts to be shown again. One appeal per post. */
export async function submitContentAppeal(member: Member, type: string, targetId: string, rawMessage: string): Promise<void> {
  const message = messageInput.parse(rawMessage);
  if (!isHideable(type) || !validId(targetId)) throw new ServiceError("Post not found.");
  const c = HIDEABLE[type];
  const found = await db.execute<{ hidden: boolean }>(sql`
    SELECT t.hidden_at IS NOT NULL AS hidden FROM ${sql.raw(c.table)} t
    WHERE t.${sql.raw(c.id)} = ${targetId} AND t.${sql.raw(c.author)} = ${member.id}`);
  const row = found.rows[0];
  if (!row) throw new ServiceError("Post not found.");
  if (!row.hidden) throw new ServiceError("This post isn't hidden.");
  const [earlier] = await db
    .select({ status: appeals.status })
    .from(appeals)
    .where(and(eq(appeals.targetType, type), eq(appeals.targetId, targetId)))
    .orderBy(desc(appeals.createdAt))
    .limit(1);
  if (earlier?.status === "OPEN") throw new ServiceError("You already appealed this; AGOD staff will look at it soon.");
  if (earlier?.status === "REJECTED") throw new ServiceError("AGOD staff already looked at an appeal about this post and kept it hidden.");
  await db.insert(appeals).values({ kind: "CONTENT", email: member.email, userId: member.id, targetType: type, targetId, message });
}

// --- Staff -----------------------------------------------------------------------------------

async function requireStaff(member: Member) {
  const staff = await asStaff(member);
  if (!staff) throw new ServiceError("Only AGOD back-office staff can do that.");
  return staff;
}

export type OpenAppeal = {
  id: string;
  kind: "ACCOUNT" | "CONTENT";
  email: string;
  message: string;
  createdAt: Date;
  person: { id: string; name: string; active: boolean } | null;
  // What the appeal is about and why it was hidden or blocked (from the back-office log).
  what: string;
  link: string | null;
  why: string | null;
};

/** Appeals waiting for a decision, oldest first. */
export async function openAppeals(member: Member): Promise<OpenAppeal[]> {
  await requireStaff(member);
  const rows = await db
    .select({ a: appeals, name: users.name, active: users.active })
    .from(appeals)
    .leftJoin(users, eq(users.id, appeals.userId))
    .where(eq(appeals.status, "OPEN"))
    .orderBy(appeals.createdAt)
    .limit(100);
  const out: OpenAppeal[] = [];
  for (const { a, name, active } of rows) {
    const person = a.userId && name !== null ? { id: a.userId, name, active: !!active } : null;
    if (a.kind === "CONTENT" && a.targetType && a.targetId && isHideable(a.targetType)) {
      const c = HIDEABLE[a.targetType];
      const [t] = (
        await db.execute<{ label: string | null; link: string | null; reason: string | null }>(sql`
          SELECT ${sql.raw(c.label)} AS label, ${sql.raw(c.link)} AS link, t.hidden_reason AS reason
          FROM ${sql.raw(c.table)} t WHERE t.${sql.raw(c.id)} = ${a.targetId}`)
      ).rows;
      out.push({ id: a.id, kind: "CONTENT", email: a.email, message: a.message, createdAt: a.createdAt, person, what: `${c.kind}: ${t?.label ?? "(deleted)"}`, link: t?.link ?? null, why: t?.reason ?? null });
    } else {
      const [log] = a.userId
        ? await db
            .select({ reason: platformAudit.reason })
            .from(platformAudit)
            .where(and(eq(platformAudit.targetType, "USER"), eq(platformAudit.targetId, a.userId), sql`${platformAudit.action} IN ('LOGIN_BLOCKED', 'BANNED_AND_CLEANED')`))
            .orderBy(desc(platformAudit.createdAt))
            .limit(1)
        : [];
      out.push({ id: a.id, kind: "ACCOUNT", email: a.email, message: a.message, createdAt: a.createdAt, person, what: "Blocked login", link: a.userId ? `/console/people/${a.userId}` : null, why: log?.reason ?? null });
    }
  }
  return out;
}

/**
 * Accepting restores the login (posts a ban hid stay hidden; the person can appeal them once
 * signed in) or shows the post again. The person is emailed the decision and the note.
 */
export async function decideAppeal(member: Member, appealId: string, accept: boolean, rawNote: string): Promise<void> {
  const staff = await requireStaff(member);
  const note = noteInput.parse(rawNote);
  if (!validId(appealId)) throw new ServiceError("Appeal not found.");
  const [a] = await db.select().from(appeals).where(eq(appeals.id, appealId));
  if (!a) throw new ServiceError("Appeal not found.");
  if (a.status !== "OPEN") throw new ServiceError("Someone already decided this appeal.");

  let what = "your login";
  let label = `Login of ${a.email}`;
  if (a.kind === "CONTENT" && a.targetType && a.targetId && isHideable(a.targetType)) {
    const c = HIDEABLE[a.targetType];
    what = `your ${c.kind.toLowerCase()}`;
    label = `${c.kind} by ${a.email}`;
  }
  if (accept) {
    if (a.kind === "ACCOUNT") {
      const [u] = a.userId ? await db.select({ active: users.active }).from(users).where(eq(users.id, a.userId)) : [];
      if (u && !u.active) await setLoginBlocked(staff, a.userId!, false, `Appeal accepted: ${note}`);
    } else if (a.targetType && a.targetId && isHideable(a.targetType)) {
      const c = HIDEABLE[a.targetType];
      await db.execute(sql`
        UPDATE ${sql.raw(c.table)} SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL
        WHERE ${sql.raw(c.id)} = ${a.targetId}`);
    }
  }
  // The status check makes a double click (or two staff at once) decide only once.
  const updated = await db
    .update(appeals)
    .set({ status: accept ? "ACCEPTED" : "REJECTED", decidedBy: staff.id, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(appeals.id, a.id), eq(appeals.status, "OPEN")))
    .returning({ id: appeals.id });
  if (updated.length === 0) throw new ServiceError("Someone already decided this appeal.");
  await db.insert(platformAudit).values({ actorId: staff.id, action: accept ? "APPEAL_ACCEPTED" : "APPEAL_REJECTED", targetType: "APPEAL", targetId: a.id, targetLabel: label.slice(0, 300), reason: note });

  const [person] = a.userId ? await db.select({ name: users.name }).from(users).where(eq(users.id, a.userId)) : [];
  try {
    await sendAccountEmail(a.email, appealDecisionMessage({ name: person?.name ?? a.email, what, accepted: accept, note, url: appUrl(a.kind === "ACCOUNT" ? "/sign-in" : "/community") }));
  } catch (error) {
    console.error("Sending the appeal decision failed", error instanceof Error ? error.message : error);
  }
}

