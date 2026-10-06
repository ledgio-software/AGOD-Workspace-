import { openSecret, sealSecret } from "./secret";

// Phase 21: the sign-in attempt (state and PKCE verifier) is kept in a short-lived, encrypted,
// httpOnly cookie between /api/google/connect and /api/google/callback.

export const OAUTH_COOKIE = "agod_google_oauth";
export const OAUTH_COOKIE_PATH = "/api/google";
const TTL_MS = 10 * 60_000;

type Attempt = { state: string; verifier: string; userId: string; expires: number };

export function sealAttempt(attempt: Omit<Attempt, "expires">, now = Date.now()): string {
  return sealSecret(JSON.stringify({ ...attempt, expires: now + TTL_MS }));
}

/** The attempt, if the cookie is genuine, not expired, and matches this callback and person. */
export function openAttempt(cookie: string | undefined, o: { state: string | null; userId: string }, now = Date.now()): Attempt | null {
  if (!cookie || !o.state) return null;
  try {
    const attempt = JSON.parse(openSecret(cookie)) as Attempt;
    if (attempt.expires < now || attempt.state !== o.state || attempt.userId !== o.userId) return null;
    return attempt;
  } catch {
    return null;
  }
}
