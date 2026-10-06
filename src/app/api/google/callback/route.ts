import { type NextRequest, NextResponse } from "next/server";
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, openAttempt } from "@/lib/google/oauth-cookie";
import { getRequestMeta } from "@/lib/request-meta";
import { getCurrentUser } from "@/lib/session";
import { completeCompanyConnect } from "@/modules/google";
import { ServiceError } from "@/modules/errors";

// Phase 21: Google sends the browser back here after the consent screen. The result is shown on
// the Integrations page as a fixed message (nothing from the URL is echoed back).

export async function GET(request: NextRequest) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.redirect(new URL("/sign-in", request.url));
  const url = new URL(request.url);
  const done = (result: string) => {
    const response = NextResponse.redirect(new URL(`/integrations?google=${result}`, request.url));
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };

  const attempt = openAttempt(request.cookies.get(OAUTH_COOKIE)?.value, { state: url.searchParams.get("state"), userId: actor.id, orgId: actor.orgId });
  if (!attempt) return done("expired");
  if (url.searchParams.get("error")) return done("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return done("failed");

  try {
    await completeCompanyConnect(actor, { code, verifier: attempt.verifier }, await getRequestMeta());
    return done("connected");
  } catch (error) {
    console.error("Connecting Google failed", error instanceof Error ? error.message : error);
    return done(error instanceof ServiceError && error.message.includes("Drive access") ? "no-drive" : "failed");
  }
}
