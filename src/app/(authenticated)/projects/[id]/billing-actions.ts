"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import {
  type PresetKey,
  addStage,
  applyPreset,
  createChangeRequest,
  decideChangeRequest,
  invoiceStage,
  markChangeRequestSent,
  recordSignOff,
  removeStage,
  sendForReview,
} from "@/modules/billing";

// Phase 29: the Billing tab of a client project.

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");
const done = (projectId: string) => revalidatePath(`/projects/${projectId}`);

export async function presetAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await applyPreset(actor, projectId, text(form, "preset") as PresetKey, await getRequestMeta());
    return undefined;
  }, "Payment plan set. Adjust any stage below.");
  if (result.ok) done(projectId);
  return result;
}

export async function addStageAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await addStage(
      actor,
      projectId,
      { label: text(form, "label"), kind: text(form, "kind") as "DEPOSIT", amount: text(form, "amount"), milestoneId: text(form, "milestoneId") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Payment added to the plan.");
  if (result.ok) done(projectId);
  return result;
}

export async function removeStageAction(projectId: string, stageId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await removeStage(actor, stageId, await getRequestMeta());
    return undefined;
  }, "Removed.");
  if (result.ok) done(projectId);
  return result;
}

/** Creates the stage's draft invoice and opens it. */
export async function invoiceStageAction(projectId: string, stageId: string): Promise<Result> {
  const actor = await requireUser();
  const meta = await getRequestMeta();
  const result = await runAction(() => invoiceStage(actor, stageId, meta));
  if (!result.ok) return result;
  done(projectId);
  redirect(`/invoices/${result.data}`);
}

export async function reviewAction(projectId: string, stageId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await sendForReview(actor, stageId, { on: text(form, "on") }, await getRequestMeta());
    return undefined;
  }, "Noted: the client is reviewing it.");
  if (result.ok) done(projectId);
  return result;
}

export async function signOffAction(projectId: string, stageId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await recordSignOff(actor, stageId, { on: text(form, "on"), note: text(form, "note") }, await getRequestMeta());
    return undefined;
  }, "Client sign-off recorded.");
  if (result.ok) done(projectId);
  return result;
}

export async function createChangeAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createChangeRequest(
      actor,
      projectId,
      { title: text(form, "title"), description: text(form, "description"), amount: text(form, "amount"), extraDays: text(form, "extraDays") || "0" },
      await getRequestMeta(),
    );
    return undefined;
  }, "Change request saved as a draft.");
  if (result.ok) done(projectId);
  return result;
}

export async function sendChangeAction(projectId: string, changeId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await markChangeRequestSent(actor, changeId, await getRequestMeta());
    return undefined;
  }, "Marked as sent to the client.");
  if (result.ok) done(projectId);
  return result;
}

export async function decideChangeAction(projectId: string, changeId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const approve = text(form, "decision") === "approve";
  const result = await runAction(async () => {
    await decideChangeRequest(actor, changeId, { approve, on: text(form, "on"), note: text(form, "note") }, await getRequestMeta());
    return undefined;
  }, approve ? "Approved: the project's value and payment plan are updated." : "Recorded as rejected.");
  if (result.ok) done(projectId);
  return result;
}
