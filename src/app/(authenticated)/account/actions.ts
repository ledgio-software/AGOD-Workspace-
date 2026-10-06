"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { disconnectPersonal, syncMyCalendarNow } from "@/modules/google/calendar";
import { setDailyEmail } from "@/modules/notifications/preferences";

export async function setDailyEmailAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const on = form.get("dailyEmail") === "true";
  const result = await runAction(async () => {
    await setDailyEmail(actor, on, await getRequestMeta());
    return undefined;
  }, on ? "Daily email turned on." : "Daily email turned off.");
  if (result.ok) revalidatePath("/account");
  return result;
}

export async function syncMyCalendarAction(): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(() => syncMyCalendarNow(actor));
  revalidatePath("/account");
  if (!result.ok) return result;
  const s = result.data;
  return {
    ok: true,
    data: undefined,
    message: `Calendar synced: ${s.created} added, ${s.updated} updated, ${s.removed} removed${s.failures.length ? `, ${s.failures.length} problems` : ""}.`,
  };
}

export async function disconnectMyCalendarAction(): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await disconnectPersonal(actor, await getRequestMeta());
    return undefined;
  }, "Google Calendar disconnected. The calendar stays in your Google account; delete it there if you no longer want it.");
  revalidatePath("/account");
  return result;
}
