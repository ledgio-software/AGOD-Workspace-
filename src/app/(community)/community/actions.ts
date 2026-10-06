"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { COMPANY_COOKIE, companiesOf, getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { acceptConduct, reportProfile, resolveReport, setOrganizer, unhideProfile, updateProfile } from "@/modules/community";
import { ServiceError } from "@/modules/errors";
import { createOrganization } from "@/modules/orgs";

// Phase 25: community actions. Any signed-in person may use them (company or not); the module
// checks organizer rights itself.

async function member() {
  const user = await getSignedIn();
  if (!user) redirect("/sign-in");
  return user;
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function refreshCommunity() {
  revalidatePath("/community", "layout");
  revalidatePath("/members", "layout");
  revalidatePath("/");
}

export async function acceptConductAction(): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => { await acceptConduct(me); return undefined; }, "Thank you. Welcome to the community!");
  refreshCommunity();
  return result;
}

export async function updateProfileAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => {
    await updateProfile(me, {
      handle: text(form, "handle"),
      headline: text(form, "headline"),
      bio: text(form, "bio"),
      city: text(form, "city"),
      tools: text(form, "tools"),
      websiteUrl: text(form, "websiteUrl"),
      githubUrl: text(form, "githubUrl"),
      linkedinUrl: text(form, "linkedinUrl"),
      xUrl: text(form, "xUrl"),
      reviewer: form.get("reviewer") === "on",
      wantsMentor: form.get("wantsMentor") === "on",
      visibility: text(form, "visibility") === "MEMBERS" ? "MEMBERS" : "PUBLIC",
    });
    return undefined;
  }, "Profile saved.");
  if (result.ok) refreshCommunity();
  return result;
}

export async function reportProfileAction(handle: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  return runAction(async () => {
    await reportProfile(me, handle, { reason: text(form, "reason") });
    return undefined;
  }, "Thank you. The organizers will look at it.");
}

export async function resolveReportAction(reportId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  const action = text(form, "action") === "HIDE" ? "HIDE" : "DISMISS";
  const result = await runAction(async () => {
    await resolveReport(me, reportId, { action, note: text(form, "note") });
    return undefined;
  }, action === "HIDE" ? "Profile hidden and report closed." : "Report dismissed.");
  if (result.ok) refreshCommunity();
  return result;
}

export async function unhideProfileAction(handle: string): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => { await unhideProfile(me, handle); return undefined; }, "The profile is visible again.");
  if (result.ok) refreshCommunity();
  return result;
}

export async function setOrganizerAction(handle: string, on: boolean): Promise<ActionResult> {
  const me = await member();
  const result = await runAction(async () => { await setOrganizer(me, handle, on); return undefined; }, on ? "They are now an organizer." : "They are a builder again.");
  if (result.ok) refreshCommunity();
  return result;
}

/** A member without a company creates one (while sign-up is open) and opens it. */
export async function createCompanyAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await member();
  let orgId = "";
  const result = await runAction(async () => {
    if (!signupOpen()) throw new ServiceError("Creating new companies is closed right now.");
    if ((await companiesOf(me.id)).length > 0) throw new ServiceError("You already belong to a company.");
    orgId = (await createOrganization({ name: text(form, "name"), ownerId: me.id })).id;
    return undefined;
  });
  if (!result.ok) return result;
  (await cookies()).set(COMPANY_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
