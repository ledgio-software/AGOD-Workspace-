import { createHmac } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginSignals, users } from "@/lib/db/schema";

// Phase 42: linked accounts. Each sign-in records the network (IP address) and device (browser) it
// came from, as keyed hashes only, so staff can see accounts that share them, or whose email is the
// same apart from numbers and dots (ama1@, ama.2@...). That is how one person runs several accounts
// to vote for themselves, or comes back after a ban. Mobile networks in Ghana put many people
// behind one address, so a network shared by many accounts is not counted as a link.

/** A network seen with more accounts than this is a shared one (mobile carrier, campus, café). */
export const BUSY_NETWORK = 8;
const LOOKBACK_DAYS = 90;

const key = () => process.env.BETTER_AUTH_SECRET ?? "dev-only-key";
const hash = (kind: string, value: string) => createHmac("sha256", key()).update(`${kind}:${value}`).digest("base64url").slice(0, 32);

/** A keyed hash of a network address, for rate limits that shouldn't store the address. */
export const networkKey = (ip: string) => hash("ip", ip.trim().toLowerCase());

/** The browser and system, without version numbers, so an update doesn't count as a new device. */
export function deviceOf(userAgent: string): string {
  return userAgent
    .replace(/\d+(\.\d+)+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Called on every sign-in (src/lib/auth.ts). Never throws. */
export async function recordLogin(userId: string, ip: string | null | undefined, userAgent: string | null | undefined) {
  try {
    if (!ip) return;
    const ipHash = networkKey(ip);
    const deviceHash = hash("ua", deviceOf(userAgent ?? ""));
    await db
      .insert(loginSignals)
      .values({ userId, ipHash, deviceHash })
      .onConflictDoUpdate({ target: [loginSignals.userId, loginSignals.ipHash, loginSignals.deviceHash], set: { lastSeen: sql`now()` } });
  } catch (error) {
    console.error("Recording sign-in signals failed", error instanceof Error ? error.message : error);
  }
}

/** "ama.mensah+jobs2@gmail.com" → "amamensah": the part people vary to make look-alike accounts. */
export function emailBase(email: string): string {
  const local = email.toLowerCase().split("@")[0].split("+")[0];
  return local.replace(/[0-9._-]/g, "");
}

export type LinkedAccount = { userId: string; name: string; email: string; active: boolean; joined: Date; reasons: string[] };

/** Accounts that look like the same person as this one, strongest first. */
export async function linkedAccounts(userId: string): Promise<LinkedAccount[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const shared = await db.execute<{ user_id: string; same_device: boolean }>(sql`
    WITH mine AS (SELECT ip_hash, device_hash FROM login_signals WHERE user_id = ${userId} AND last_seen > ${since}),
         quiet AS (SELECT ip_hash FROM login_signals WHERE ip_hash IN (SELECT ip_hash FROM mine) GROUP BY ip_hash HAVING count(DISTINCT user_id) <= ${BUSY_NETWORK})
    SELECT s.user_id, bool_or(s.device_hash IN (SELECT device_hash FROM mine m WHERE m.ip_hash = s.ip_hash)) AS same_device
    FROM login_signals s
    WHERE s.ip_hash IN (SELECT ip_hash FROM quiet) AND s.user_id <> ${userId} AND s.last_seen > ${since}
    GROUP BY s.user_id`);
  const reasons = new Map<string, string[]>();
  for (const r of shared.rows) reasons.set(r.user_id, [r.same_device ? "Same device and network" : "Same network"]);

  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const base = me ? emailBase(me.email) : "";
  if (base.length >= 4) {
    const similar = await db
      .select({ id: users.id })
      .from(users)
      .where(and(ne(users.id, userId), sql`regexp_replace(split_part(split_part(lower(${users.email}), '@', 1), '+', 1), '[0-9._-]', '', 'g') = ${base}`))
      .limit(50);
    for (const s of similar) reasons.set(s.id, [...(reasons.get(s.id) ?? []), "Almost the same email"]);
  }
  if (reasons.size === 0) return [];
  const rows = await db
    .select({ userId: users.id, name: users.name, email: users.email, active: users.active, joined: users.createdAt })
    .from(users)
    .where(inArray(users.id, [...reasons.keys()]));
  const strength = (l: LinkedAccount) => (l.reasons.includes("Same device and network") ? 3 : 0) + l.reasons.length;
  return rows.map((r) => ({ ...r, reasons: reasons.get(r.userId)! })).sort((a, b) => strength(b) - strength(a));
}

/** Blocked accounts this one is linked to (a banned person coming back), by name. */
export async function linkedBanned(userId: string): Promise<string[]> {
  return (await linkedAccounts(userId)).filter((l) => !l.active).map((l) => l.name);
}
