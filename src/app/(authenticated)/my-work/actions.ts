"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { requireUser } from "@/lib/session";
import { markAllNotificationsRead } from "@/modules/notifications";

export async function markNotificationsReadAction(): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await markAllNotificationsRead(actor);
    return undefined;
  });
  if (result.ok) revalidatePath("/my-work");
  return result;
}
