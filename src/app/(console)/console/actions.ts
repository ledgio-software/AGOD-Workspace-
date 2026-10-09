"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getSignedIn } from "@/lib/session";
import { sendResetLink, setCompanySuspended, setLoginBlocked, setOrganizerRole } from "@/modules/platform";
import { banAndCleanUp, clearFlag, hideFlagged, setTrusted } from "@/modules/safety";

// Phase 40: AGOD back-office actions. Each one checks staff again in src/modules/platform.

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

async function member() {
  const me = await getSignedIn();
  if (!me) notFound();
  return me;
}

const done = <T>(r: ActionResult<T>, message: string, paths: string[]): Result => {
  if (!r.ok) return r;
  for (const p of paths) revalidatePath(p);
  return { ok: true, data: undefined, message };
};

export async function suspendCompanyAction(orgId: string, suspend: boolean, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const r = await runAction(() => setCompanySuspended(me, orgId, suspend, text(form, "reason")));
  return done(r, suspend ? "Suspended. Its members can no longer open it." : "Restored. Its members can open it again.", ["/console/companies", `/console/companies/${orgId}`, "/console"]);
}

export async function blockLoginAction(userId: string, block: boolean, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const r = await runAction(() => setLoginBlocked(me, userId, block, text(form, "reason")));
  return done(r, block ? "Blocked and signed out everywhere." : "Restored. They can sign in again.", ["/console/people", `/console/people/${userId}`, "/console"]);
}

export async function resetLinkAction(userId: string): Promise<Result> {
  const me = await member();
  const r = await runAction(() => sendResetLink(me, userId));
  return done(r, "Sent. The link works for one day.", [`/console/people/${userId}`]);
}

export async function organizerAction(on: boolean, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const r = await runAction(() => setOrganizerRole(me, text(form, "handle"), on));
  return done(r, on ? "They're an organizer now." : "They're a builder again.", ["/console/moderation"]);
}

// --- Phase 41: trust & safety ---------------------------------------------------------------

export async function clearFlagAction(flagId: string): Promise<Result> {
  const me = await member();
  const r = await runAction(() => clearFlag(me, flagId));
  return done(r, "Cleared. It stays up (a held job is now listed).", ["/console/safety", "/console", "/jobs"]);
}

export async function hideFlaggedAction(flagId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const r = await runAction(() => hideFlagged(me, flagId, text(form, "reason")));
  return done(r, "Hidden. Organizers can show it again on its page.", ["/console/safety", "/console"]);
}

export async function banAction(userId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const me = await member();
  const r = await runAction(() => banAndCleanUp(me, userId, text(form, "reason")));
  return r.ok ? done(r, `Banned. ${r.data} item(s) hidden and they're signed out.`, ["/console/safety", `/console/people/${userId}`, "/console"]) : r;
}

export async function trustAction(userId: string, trusted: boolean): Promise<Result> {
  const me = await member();
  const r = await runAction(() => setTrusted(me, userId, trusted));
  return done(r, trusted ? "Limits lifted: they can post jobs, share links and ask mentors now." : "New-account limits apply again.", [`/console/people/${userId}`]);
}
