"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { createAdjustment, recordPayment } from "@/modules/payments";
import { raiseQuestion, resolveQuestion, reviewQuestion } from "@/modules/questions";

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function refresh(entryId: string) {
  revalidatePath(`/payouts/${entryId}`);
  revalidatePath("/ledger");
  revalidatePath("/dashboard");
  revalidatePath("/my-work");
  revalidatePath("/questions");
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

export async function raiseQuestionAction(entryId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await raiseQuestion(actor, entryId, { question: text(form, "question") }, await getRequestMeta());
    return undefined;
  }, "Question sent. The project manager will review it.");
  if (result.ok) refresh(entryId);
  return result;
}

export async function reviewQuestionAction(questionId: string, entryId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const outcome = text(form, "outcome") as "NO_CHANGE" | "NEEDS_ADJUSTMENT";
  const result = await runAction(async () => {
    await reviewQuestion(actor, questionId, { outcome, note: text(form, "note") }, await getRequestMeta());
    return undefined;
  }, outcome === "NO_CHANGE" ? "Answered and closed." : "Sent to an Admin for an adjustment.");
  if (result.ok) refresh(entryId);
  return result;
}

export async function resolveQuestionAction(questionId: string, entryId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const type = text(form, "type");
  const result = await runAction(async () => {
    await resolveQuestion(
      actor,
      questionId,
      {
        resolution: text(form, "resolution"),
        adjustment: type ? { type, amount: text(form, "amount"), reason: text(form, "resolution") } : undefined,
      },
      await getRequestMeta(),
    );
    return undefined;
  }, type ? "Adjustment recorded and question resolved." : "Question resolved without a change.");
  if (result.ok) refresh(entryId);
  return result;
}
