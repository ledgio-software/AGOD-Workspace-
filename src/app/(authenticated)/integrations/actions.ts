"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { disconnectCompany, syncDriveNow } from "@/modules/google";
import { syncCalendarsNow } from "@/modules/google/calendar";
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

export async function disconnectGoogleAction(): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await disconnectCompany(actor, await getRequestMeta());
    return undefined;
  }, "Google disconnected. The files stay in that Google Drive.");
  revalidatePath("/integrations");
  return result;
}

export async function syncDriveAction(): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    const drive = await syncDriveNow(actor);
    // Phase 24: the calendars too (problems there are listed on the page, not thrown).
    const calendar = await syncCalendarsNow(actor);
    return { drive, calendar };
  });
  revalidatePath("/integrations");
  if (!result.ok) return result;
  const { drive: s, calendar: c } = result.data;
  return {
    ok: true,
    data: undefined,
    message:
      `Drive synced: ${s.folders} folders checked, ${s.shared} shares added, ${s.unshared} removed${s.failures.length ? `, ${s.failures.length} problems (listed below)` : ""}. ` +
      `Calendars: ${c.created} events added, ${c.updated} updated, ${c.removed} removed${c.failures.length ? `, ${c.failures.length} problems` : ""}.`,
  };
}
