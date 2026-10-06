"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { COMPANY_COOKIE, companiesOf, getSignedIn, requireUser } from "@/lib/session";
import { setSelfApproval, updateOrganization } from "@/modules/orgs";

/** Remembers the chosen company for this browser (only one the person is an active member of). */
export async function switchCompanyAction(form: FormData): Promise<void> {
  const user = await getSignedIn();
  if (!user) redirect("/sign-in");
  const wanted = String(form.get("companyId") ?? "");
  if ((await companiesOf(user.id)).some((c) => c.id === wanted)) {
    (await cookies()).set(COMPANY_COOKIE, wanted, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function updateCompanyAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateOrganization(actor, { name: String(form.get("name") ?? ""), projectCodePrefix: String(form.get("projectCodePrefix") ?? "") }, await getRequestMeta());
    return undefined;
  }, "Company details saved.");
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Phase 28: two people for money (on), or one person may approve and pay themselves (off). */
export async function selfApprovalAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const allow = form.get("allow") === "true";
  const result = await runAction(async () => {
    await setSelfApproval(actor, { allow, reason: String(form.get("reason") ?? "") }, await getRequestMeta());
    return undefined;
  }, allow ? "Done. One person may now approve and pay their own work." : "Done. Money now always needs two people.");
  if (result.ok) revalidatePath("/company");
  return result;
}
