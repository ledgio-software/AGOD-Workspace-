"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getSignedIn } from "@/lib/session";
import { sendResetLink, setCompanySuspended, setLoginBlocked, setOrganizerRole } from "@/modules/platform";

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
