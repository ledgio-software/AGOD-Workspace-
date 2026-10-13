import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { memberProfiles, riskFlags, users } from "@/lib/db/schema";
import { FLAG_SCORE, scanText } from "@/lib/risk";
import { isPlatformAdmin, organizerEmails } from "@/lib/staff";
import { ServiceError } from "@/modules/errors";
import { linkedBanned } from "./links";

// Phase 41: trust & safety, the part every posting path calls. It scores what was written
// (src/lib/risk.ts), files a flag for AGOD staff when it looks like a scam, and keeps new accounts
// from the things scammers need most (posting jobs, links in chat, asking for mentorship) until
// they've been around a few days with a confirmed email. Screening never blocks a post by itself
// and never breaks one: if it fails, the post goes through and the error is logged.

type Member = { id: string; email: string };
export type FlagTarget = "JOB" | "CHAT" | "ARTICLE" | "ARTICLE_COMMENT" | "POST" | "REVIEW" | "PROFILE" | "LIBRARY" | "TEAM";

export const PROBATION_DAYS = 3;
/** New accounts' posts score a little higher: most scams come from accounts made that day. */
const NEW_ACCOUNT_BONUS = 15;
/** Enough on its own to flag a post, and to hold a job. */
const LINKED_TO_BANNED = 40;

export type Standing = { newAccount: boolean; trusted: boolean; reason: string | null };

/** Whether this person is still under the new-account limits, and why. Staff and organizers never are. */
export async function standing(member: Member): Promise<Standing> {
  if (isPlatformAdmin(member.email) || organizerEmails().has(member.email.toLowerCase())) return { newAccount: false, trusted: true, reason: null };
  const [row] = await db
    .select({ createdAt: users.createdAt, verified: users.emailVerified, trustedAt: memberProfiles.trustedAt, role: memberProfiles.communityRole })
    .from(users)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
    .where(eq(users.id, member.id));
  if (!row) return { newAccount: true, trusted: false, reason: "Account not found." };
  if (row.trustedAt || row.role === "ORGANIZER") return { newAccount: false, trusted: true, reason: null };
  const days = (Date.now() - row.createdAt.getTime()) / 86_400_000;
  if (!row.verified) return { newAccount: true, trusted: false, reason: "Confirm your email address first (check your inbox for the link)." };
  if (days < PROBATION_DAYS) {
    const left = Math.ceil(PROBATION_DAYS - days);
    return { newAccount: true, trusted: false, reason: `New accounts can do this ${PROBATION_DAYS} days after joining (${left} more ${left === 1 ? "day" : "days"}). It keeps scammers out.` };
  }
  return { newAccount: false, trusted: false, reason: null };
}

/** Refuses an action new accounts can't take yet, saying why. */
export async function requireEstablished(member: Member, what: string) {
  const s = await standing(member);
  if (s.newAccount) throw new ServiceError(`${what}: ${s.reason}`);
}

/** All the words in a form's fields (strings and lists of strings), for screening. */
export function textOf(input: Record<string, unknown>): string {
  return Object.values(input)
    .flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []))
    .join("\n");
}

/**
 * Scores what was just written and files (or updates) a flag for staff when it looks risky.
 * Returns the score so callers can hold a job. Never throws.
 */
export async function screen(member: Member, target: FlagTarget, targetId: string, text: string, extra: { label: string; weight: number }[] = []): Promise<number> {
  try {
    const result = scanText(text);
    const s = await standing(member);
    // Phase 42: a new account that shares a device or network with a banned one is likely the same
    // person coming back, whatever they write.
    const banned = s.newAccount ? await linkedBanned(member.id) : [];
    const found = result.score + extra.reduce((n, e) => n + e.weight, 0);
    const score = Math.min(100, found + (s.newAccount && found > 0 ? NEW_ACCOUNT_BONUS : 0) + (banned.length ? LINKED_TO_BANNED : 0));
    if (score < FLAG_SCORE) return score;
    const signals = [...result.signals.map((x) => x.label), ...extra.map((e) => e.label)];
    if (banned.length) signals.push(`Linked to a banned account (${banned.slice(0, 3).join(", ")})`);
    if (s.newAccount) signals.push("Posted by a new account");
    const excerpt = result.signals
      .map((x) => x.match)
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300);
    await db
      .insert(riskFlags)
      .values({ targetType: target, targetId, authorId: member.id, score, signals, excerpt: excerpt || null })
      .onConflictDoUpdate({
        target: [riskFlags.targetType, riskFlags.targetId],
        // An edit that is still risky reopens the flag with the new findings.
        set: { score, signals, excerpt: excerpt || null, status: "OPEN", reviewedBy: null, reviewedAt: null, createdAt: sql`now()` },
      });
    return score;
  } catch (error) {
    console.error("Safety screening failed", error instanceof Error ? error.message : error);
    return 0;
  }
}
