"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getSignedIn } from "@/lib/session";
import { refreshNewsNow, setNewsHidden, setNewsSourceEnabled, toggleNewsUseful } from "@/modules/community/news";

// Phase 38: tech news.

type Result = ActionResult<undefined>;

async function member() {
  const me = await getSignedIn();
  if (!me) redirect("/sign-in");
  return me;
}

function refresh() {
  revalidatePath("/news");
  revalidatePath("/community/news");
}

export async function usefulNewsAction(id: string): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await toggleNewsUseful(me, id);
    return undefined;
  });
  if (result.ok) refresh();
  return result;
}

export async function hideNewsAction(id: string, hidden: boolean): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await setNewsHidden(me, id, hidden);
    return undefined;
  }, hidden ? "Hidden. Members no longer see this headline." : "Shown again.");
  if (result.ok) refresh();
  return result;
}

export async function newsSourceAction(key: string, enabled: boolean): Promise<Result> {
  const me = await member();
  const result = await runAction(async () => {
    await setNewsSourceEnabled(me, key, enabled);
    return undefined;
  }, enabled ? "Switched on. Its headlines show again." : "Switched off. Its headlines are no longer shown.");
  if (result.ok) refresh();
  return result;
}

/** Organizers: fetch every source now instead of waiting for the next refresh. */
export async function refreshNewsAction(): Promise<Result> {
  const me = await member();
  const result = await runAction(() => refreshNewsNow(me));
  if (!result.ok) return result;
  refresh();
  const { checked, saved, failed } = result.data;
  return { ok: true, data: undefined, message: `Checked ${checked} sources, saved ${saved} headlines${failed.length ? `; ${failed.length} failed (see below)` : ""}.` };
}
