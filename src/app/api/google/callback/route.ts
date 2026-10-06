import { type NextRequest, NextResponse } from "next/server";
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, openAttempt } from "@/lib/google/oauth-cookie";
import { getRequestMeta } from "@/lib/request-meta";
import { getCurrentUser } from "@/lib/session";
import { completeCompanyConnect } from "@/modules/google";
import { completePersonalConnect, syncCompanyCalendar } from "@/modules/google/calendar";
import { ServiceError } from "@/modules/errors";

// Phase 21: Google sends the browser back here after the consent screen. The result is shown on
// the Integrations page as a fixed message (nothing from the URL is echoed back). Phase 24: a personal
// calendar connection returns to the Account page.

export async function GET(request: NextRequest) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.redirect(new URL("/sign-in", request.url));
  const url = new URL(request.url);
  let page = "/integrations";
  const done = (result: string) => {
    const response = NextResponse.redirect(new URL(`${page}?google=${result}`, request.url));
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };

  const attempt = openAttempt(request.cookies.get(OAUTH_COOKIE)?.value, { state: url.searchParams.get("state"), userId: actor.id, orgId: actor.orgId });
  if (!attempt) return done("expired");
  if (attempt.kind === "personal") page = "/account";
  if (url.searchParams.get("error")) return done("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return done("failed");

  try {
    if (attempt.kind === "personal") {
      await completePersonalConnect(actor, { code, verifier: attempt.verifier }, await getRequestMeta());
      return done("connected");
    }
    await completeCompanyConnect(actor, { code, verifier: attempt.verifier }, await getRequestMeta());
    // The company calendar is set up straight away (the daily job keeps it up to date).
    await syncCompanyCalendar(actor.orgId).catch((error) => console.error("Company calendar sync after connecting failed", error instanceof Error ? error.message : error));
    return done("connected");
  } catch (error) {
    console.error("Connecting Google failed", error instanceof Error ? error.message : error);
    if (error instanceof ServiceError && error.message.includes("Calendar access")) return done("no-calendar");
    return done(error instanceof ServiceError && error.message.includes("Drive access") ? "no-drive" : "failed");
  }
}
