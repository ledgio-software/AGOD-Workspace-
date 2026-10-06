"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { requireUser } from "@/lib/session";
import { runDailyRemindersNow, sendTestEmail } from "@/modules/jobs/daily";

export async function sendTestEmailAction(): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await sendTestEmail(actor);
    return undefined;
  }, "Test email sent. Check your inbox (and spam folder).");
}

export async function runDailyNowAction(): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await runDailyRemindersNow(actor);
    return undefined;
  }, "Daily reminders ran. See the latest run below.");
  revalidatePath("/integrations");
  return result;
}
