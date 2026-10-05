"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { createAdjustment, recordPayment } from "@/modules/payments";

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function refresh(entryId: string) {
  revalidatePath(`/payouts/${entryId}`);
  revalidatePath("/ledger");
  revalidatePath("/dashboard");
  revalidatePath("/my-work");
}

export async function recordPaymentAction(entryId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await recordPayment(
      actor,
      entryId,
      {
        amount: text(form, "amount"),
        method: text(form, "method") as "MOBILE_MONEY",
        reference: text(form, "reference"),
        paidOn: text(form, "paidOn"),
        evidenceUrl: text(form, "evidenceUrl"),
        notes: text(form, "notes"),
      },
      await getRequestMeta(),
    );
    return undefined;
  }, "Payment recorded.");
  if (result.ok) refresh(entryId);
  return result;
}

export async function createAdjustmentAction(entryId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createAdjustment(
      actor,
      entryId,
      { type: text(form, "type") as "INCREASE", amount: text(form, "amount"), reason: text(form, "reason") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Adjustment recorded.");
  if (result.ok) refresh(entryId);
  return result;
}
