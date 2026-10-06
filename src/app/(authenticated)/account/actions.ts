"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
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
