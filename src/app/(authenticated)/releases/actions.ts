"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import {
  type Impact,
  createRelease,
  decideRelease,
  markDeployed,
  markRolledBack,
  securityReview,
  submitRelease,
  updateDraft,
  withdrawRelease,
} from "@/modules/releases";

// Phase 32: release approvals.

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");
const releaseFields = (form: FormData) => ({
  title: text(form, "title"),
  versionLabel: text(form, "versionLabel"),
  changeSummary: text(form, "changeSummary"),
  reason: text(form, "reason"),
  securityImpact: text(form, "securityImpact") as Impact,
  testEvidence: text(form, "testEvidence"),
  rollbackPlan: text(form, "rollbackPlan"),
  emergency: form.get("emergency") === "on",
});
const done = (releaseId: string) => {
  revalidatePath(`/releases/${releaseId}`);
  revalidatePath("/releases");
};

export async function createReleaseAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  let id = "";
  const result = await runAction(async () => {
    id = await createRelease(actor, projectId, releaseFields(form), await getRequestMeta());
    return undefined;
  });
  if (!result.ok) return result;
  revalidatePath(`/projects/${projectId}`);
  redirect(`/releases/${id}`);
}

export async function updateReleaseAction(releaseId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateDraft(actor, releaseId, releaseFields(form), await getRequestMeta());
    return undefined;
  }, "Saved.");
  if (result.ok) done(releaseId);
  return result;
}

type Actor = Awaited<ReturnType<typeof requireUser>>;

async function step(releaseId: string, message: string, fn: (actor: Actor) => Promise<void>): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await fn(actor);
    return undefined;
  }, message);
  if (result.ok) done(releaseId);
  return result;
}

export async function submitReleaseAction(releaseId: string): Promise<Result> {
  return step(releaseId, "Submitted. Managers have been told.", async (a) => submitRelease(a, releaseId, await getRequestMeta()));
}

export async function withdrawReleaseAction(releaseId: string): Promise<Result> {
  return step(releaseId, "Back to draft.", async (a) => withdrawRelease(a, releaseId, await getRequestMeta()));
}

export async function securityReviewAction(releaseId: string, _prev: Result | null, form: FormData): Promise<Result> {
  return step(releaseId, "Security check recorded.", async (a) => securityReview(a, releaseId, { note: text(form, "note") }, await getRequestMeta()));
}

export async function decideReleaseAction(releaseId: string, _prev: Result | null, form: FormData): Promise<Result> {
  return step(releaseId, "Decision recorded.", async (a) =>
    decideRelease(a, releaseId, { approve: text(form, "decision") === "approve", note: text(form, "note") }, await getRequestMeta()),
  );
}

export async function deployReleaseAction(releaseId: string, _prev: Result | null, form: FormData): Promise<Result> {
  return step(releaseId, "Marked as deployed.", async (a) => markDeployed(a, releaseId, { note: text(form, "note") }, await getRequestMeta()));
}

export async function rollBackReleaseAction(releaseId: string, _prev: Result | null, form: FormData): Promise<Result> {
  return step(releaseId, "Rollback recorded.", async (a) => markRolledBack(a, releaseId, { note: text(form, "note") }, await getRequestMeta()));
}
