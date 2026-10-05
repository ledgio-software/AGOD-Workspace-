"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { closePeriod, reopenPeriod } from "@/modules/periods";

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function closePeriodAction(period: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await closePeriod(actor, period, text(form, "note"), await getRequestMeta());
    return undefined;
  }, `${period} is closed.`);
  if (result.ok) revalidatePath("/close");
  return result;
}

export async function reopenPeriodAction(period: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await reopenPeriod(actor, period, text(form, "reason"), await getRequestMeta());
    return undefined;
  }, `${period} is open again.`);
  if (result.ok) revalidatePath("/close");
  return result;
}
