"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { ServiceError } from "@/modules/errors";
import { approveProject, rejectProject, reopenProject, requestApproval } from "@/modules/approvals";
import { changeProjectStatus, createProject, setHealthOverride, updateProject } from "@/modules/projects";
import {
  addAssignment,
  createMilestone,
  removeAssignment,
  setMilestoneStatus,
  updateAssignment,
} from "@/modules/projects/team";
import { removeAttachment, uploadAttachment } from "@/modules/attachments";
import { addComment } from "@/modules/comments";
import { recordCost, setProjectFinance, voidCost } from "@/modules/finance";
import { createIssueForTask, linkTaskUrl, setProjectRepo, unlinkTask } from "@/modules/github";
import { createProjectFolder } from "@/modules/google";
import { addProjectLink, removeProjectLink } from "@/modules/links";
import { createTask, updateTaskDetails, updateTaskProgress, waiveTask } from "@/modules/tasks";

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function projectFields(form: FormData) {
  return {
    name: text(form, "name"),
    description: text(form, "description"),
    clientType: text(form, "clientType") as "INTERNAL" | "EXTERNAL",
    // "__new" (or nothing) means a new customer typed by name.
    customerId: text(form, "customerId").startsWith("__") ? "" : text(form, "customerId"),
    clientName: text(form, "clientName"),
    totalValue: text(form, "totalValue"),
    splitMode: text(form, "splitMode") as "PERCENTAGE" | "FIXED_AMOUNT",
    agodShare: text(form, "agodShare"),
    projectOwnerId: text(form, "projectOwnerId"),
    startDate: text(form, "startDate"),
    targetDate: text(form, "targetDate"),
  };
}

function refresh(projectId?: string) {
  revalidatePath("/projects");
  revalidatePath("/my-work");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

export async function createProjectAction(_prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  let id = "";
  const result = await runAction(async () => {
    id = (await createProject(actor, projectFields(form), await getRequestMeta())).id;
    return undefined;
  });
  if (!result.ok) return result;
  refresh();
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateProject(actor, projectId, { ...projectFields(form), version: Number(text(form, "version")) }, await getRequestMeta());
    return undefined;
  }, "Project saved.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function changeStatusAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await changeProjectStatus(
      actor,
      projectId,
      { to: text(form, "to") as "PLANNING", reason: text(form, "reason") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Status updated.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function healthOverrideAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const health = text(form, "health") as "ON_TRACK" | "";
  const result = await runAction(async () => {
    await setHealthOverride(actor, projectId, { health, reason: text(form, "reason") }, await getRequestMeta());
    return undefined;
  }, health ? "Health override saved." : "Override cleared; health is calculated again.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function addAssignmentAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await addAssignment(
      actor,
      projectId,
      {
        memberId: text(form, "memberId"),
        roleOnProject: text(form, "roleOnProject"),
        split: text(form, "split"),
        rationale: text(form, "rationale"),
      },
      await getRequestMeta(),
    );
    return undefined;
  }, "Team member added.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function updateAssignmentAction(
  projectId: string,
  assignmentId: string,
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateAssignment(
      actor,
      assignmentId,
      { roleOnProject: text(form, "roleOnProject"), split: text(form, "split"), rationale: text(form, "rationale") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Saved.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function removeAssignmentAction(
  projectId: string,
  assignmentId: string,
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await removeAssignment(actor, assignmentId, text(form, "reason"), await getRequestMeta());
    return undefined;
  }, "Removed.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function createMilestoneAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createMilestone(
      actor,
      projectId,
      { title: text(form, "title"), description: text(form, "description"), dueDate: text(form, "dueDate") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Milestone added.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function milestoneStatusAction(
  projectId: string,
  milestoneId: string,
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await setMilestoneStatus(actor, milestoneId, text(form, "status") as "COMPLETED", await getRequestMeta());
    return undefined;
  });
  if (result.ok) refresh(projectId);
  return result;
}

function taskFields(form: FormData) {
  return {
    title: text(form, "title"),
    description: text(form, "description"),
    milestoneId: text(form, "milestoneId"),
    assignedTo: text(form, "assignedTo"),
    required: form.get("required") === "on",
    dueDate: text(form, "dueDate"),
    estimateHours: text(form, "estimateHours"),
  };
}

export async function createTaskAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createTask(actor, projectId, taskFields(form), await getRequestMeta());
    return undefined;
  }, "Task added.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function updateTaskDetailsAction(
  projectId: string,
  taskId: string,
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateTaskDetails(actor, taskId, taskFields(form), await getRequestMeta());
    return undefined;
  }, "Task saved.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function taskProgressAction(
  projectId: string,
  taskId: string,
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  const actor = await requireUser();
  const status = text(form, "status");
  const result = await runAction(async () => {
    await updateTaskProgress(
      actor,
      taskId,
      {
        status,
        completionNote: text(form, "completionNote"),
        completedOn: text(form, "completedOn"),
        evidenceUrl: text(form, "evidenceUrl"),
        blockedReason: text(form, "blockedReason"),
        blockedNeeds: text(form, "blockedNeeds"),
      } as never,
      await getRequestMeta(),
    );
    return undefined;
  }, "Progress saved.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function waiveTaskAction(
  projectId: string,
  taskId: string,
  _prev: Result | null,
  form: FormData,
): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await waiveTask(actor, taskId, text(form, "reason"), await getRequestMeta());
    return undefined;
  }, "Task waived.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function requestApprovalAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await requestApproval(actor, projectId, text(form, "note"), await getRequestMeta());
    return undefined;
  }, "Approval requested. The project is locked until it is reviewed.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function approveAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await approveProject(
      actor,
      projectId,
      { expectedVersion: Number(text(form, "expectedVersion")), overrideReason: text(form, "overrideReason") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Approved. Payouts were created.");
  if (result.ok) {
    refresh(projectId);
    revalidatePath("/ledger");
  }
  return result;
}

export async function rejectAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await rejectProject(actor, projectId, text(form, "reason"), await getRequestMeta());
    return undefined;
  }, "Returned for changes.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function reopenAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await reopenProject(actor, projectId, text(form, "reason"), await getRequestMeta());
    return undefined;
  }, "Reopened. Its payouts were voided.");
  if (result.ok) {
    refresh(projectId);
    revalidatePath("/ledger");
  }
  return result;
}

export async function addCommentAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await addComment(actor, projectId, { body: text(form, "body"), taskId: text(form, "taskId") });
    return undefined;
  });
  if (result.ok) refresh(projectId);
  return result;
}

export async function setRepoAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await setProjectRepo(actor, projectId, text(form, "githubRepo"), await getRequestMeta());
    return undefined;
  }, "GitHub repository saved.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function linkGithubAction(projectId: string, taskId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await linkTaskUrl(actor, taskId, text(form, "url"), await getRequestMeta());
    return undefined;
  }, "Linked.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function unlinkGithubAction(projectId: string, linkId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await unlinkTask(actor, linkId, await getRequestMeta());
    return undefined;
  }, "Link removed.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function createIssueAction(projectId: string, taskId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createIssueForTask(actor, taskId, await getRequestMeta());
    return undefined;
  }, "GitHub issue created and linked.");
  if (result.ok) refresh(projectId);
  return result;
}

async function fileFrom(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ServiceError("Choose a file to upload.");
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export async function uploadProjectFileAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await uploadAttachment(actor, { kind: "PROJECT", projectId }, await fileFrom(form), await getRequestMeta());
    return undefined;
  }, "File uploaded.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function uploadTaskFileAction(projectId: string, taskId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await uploadAttachment(actor, { kind: "TASK", taskId }, await fileFrom(form), await getRequestMeta());
    return undefined;
  }, "File attached.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function removeFileAction(projectId: string, attachmentId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await removeAttachment(actor, attachmentId, await getRequestMeta());
    return undefined;
  }, "File removed.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function addLinkAction(projectId: string, taskId: string | null, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await addProjectLink(actor, { projectId, taskId, url: text(form, "url"), title: text(form, "title") }, await getRequestMeta());
    return undefined;
  }, "Link added.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function removeLinkAction(projectId: string, linkId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await removeProjectLink(actor, linkId, await getRequestMeta());
    return undefined;
  }, "Link removed.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function createDriveFolderAction(projectId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createProjectFolder(actor, projectId);
    return undefined;
  }, "Drive folder ready and shared with the project team.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function projectFinanceAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await setProjectFinance(actor, projectId, { category: text(form, "category") as "OTHER", costBudget: text(form, "costBudget") }, await getRequestMeta());
    return undefined;
  }, "Saved.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function recordCostAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await recordCost(
      actor,
      projectId,
      {
        category: text(form, "category") as "OTHER",
        description: text(form, "description"),
        vendor: text(form, "vendor"),
        amount: text(form, "amount"),
        incurredOn: text(form, "incurredOn"),
      },
      await getRequestMeta(),
    );
    return undefined;
  }, "Cost recorded.");
  if (result.ok) refresh(projectId);
  return result;
}

export async function voidCostAction(projectId: string, costId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await voidCost(actor, costId, text(form, "reason"), await getRequestMeta());
    return undefined;
  }, "Cost voided.");
  if (result.ok) refresh(projectId);
  return result;
}
