import { NextResponse } from "next/server";
import { authorizationUrl, newAuthRequest } from "@/lib/google/client";
import { COMPANY_SCOPES, PERSONAL_SCOPES, googleConfig } from "@/lib/google/config";
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, sealAttempt } from "@/lib/google/oauth-cookie";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { googleRedirectUri } from "@/modules/google";

// Phase 21: "Connect Google" (Admins). Sends the browser to Google's consent screen; Google sends
// it back to /api/google/callback. Phase 24: `?kind=personal` is anyone's "Connect my Google
// Calendar" (only a calendar the app creates in their account; nothing else of theirs).

export async function GET(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.redirect(new URL("/sign-in", request.url));
  const kind = new URL(request.url).searchParams.get("kind") === "personal" ? "personal" : "company";
  if (kind === "company" && !can(actor, "google.manage")) return new Response("Only Admins connect Google.", { status: 403 });
  const config = googleConfig();
  if (!config) return NextResponse.redirect(new URL(kind === "personal" ? "/account?google=not-configured" : "/integrations?google=not-configured", request.url));

  const attempt = newAuthRequest();
  const url = authorizationUrl(config, {
    redirectUri: googleRedirectUri(),
    scopes: kind === "personal" ? PERSONAL_SCOPES : COMPANY_SCOPES,
    state: attempt.state,
    challenge: attempt.challenge,
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, sealAttempt({ state: attempt.state, verifier: attempt.verifier, userId: actor.id, orgId: actor.orgId, kind }), {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
