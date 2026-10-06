"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { COMPANY_COOKIE, companiesOf, getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { ServiceError } from "@/modules/errors";
import { createOrganization } from "@/modules/orgs";

/** Phase 23: someone signed in without a company creates their own (when sign-up is open). */
export async function createOwnCompanyAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await getSignedIn();
  if (!user) redirect("/sign-in");
  let orgId = "";
  const result = await runAction(async () => {
    if (!signupOpen()) throw new ServiceError("Creating new companies is closed right now.");
    if ((await companiesOf(user.id)).length > 0) throw new ServiceError("You already belong to a company.");
    orgId = (await createOrganization({ name: String(form.get("name") ?? ""), ownerId: user.id })).id;
    return undefined;
  });
  if (!result.ok) return result;
  (await cookies()).set(COMPANY_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
