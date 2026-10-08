import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic redirect only: a cookie being present is not proof of a valid session.
// Every page and mutation still verifies the session server-side.
// Phase 25: the community's public pages are open to visitors.
const PUBLIC = /^\/(?:members(?:\/.*)?|showcase(?:\/.*)?|sessions(?:\/.*)?|library(?:\/.*)?|mentors|jobs(?:\/.*)?|teams(?:\/.*)?|front\/photos\/[0-9a-f-]{36}|code-of-conduct)?$/;

export function proxy(request: NextRequest) {
  if (!PUBLIC.test(request.nextUrl.pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|api/github/webhook|api/cron|sign-in|sign-up|forgot-password|reset-password|_next/static|_next/image|favicon.ico).*)"],
};
