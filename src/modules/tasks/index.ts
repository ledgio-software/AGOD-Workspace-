import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { milestones, projects, tasks } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Actor, assertCan, can } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError } from "@/modules/errors";
import { notify } from "@/modules/notifications";
import { assertEditable, lockProject } from "@/modules/projects";
import { acceptsTaskUpdates } from "@/modules/projects/rules";
import { isOnProjectTeam } from "@/modules/projects/team";

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((v) => (v === "" ? null : v))
    .nullish();
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.iso.date("Use a valid date").nullable())
  .nullish();
const optionalId = z
  .string()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.uuid().nullable())
  .nullish();

export const taskInput = z.object({
  title: z.string().trim().min(2, "Enter a task title").max(200),
  description: optionalText(2000),
  milestoneId: optionalId,
  assignedTo: optionalId,
  required: z.boolean().default(true),
  dueDate: optionalDate,
  /** Whole hours; empty for no estimate (roadmap 2.6). */
  estimateHours: z
    .union([z.number(), z.string()])
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int("Estimate whole hours").min(1, "At least 1 hour").max(999, "At most 999 hours").nullable())
    .nullish(),
});

type TaskRow = typeof tasks.$inferSelect;
type Tx = Parameters<Parameters<typeof withActor>[1]>[0];

async function validateTaskRefs(tx: Tx, projectId: string, input: z.output<typeof taskInput>) {
  if (input.milestoneId) {
    const [milestone] = await tx.select({ projectId: milestones.projectId }).from(milestones).where(eq(milestones.id, input.milestoneId));
    if (!milestone || milestone.projectId !== projectId) throw new ServiceError("That milestone is not part of this project.");
  }
  if (input.assignedTo && !(await isOnProjectTeam(tx, projectId, input.assignedTo))) {
    throw new ServiceError("Add the member to the project team before assigning tasks to them.");
  }
}

export async function createTask(actor: Actor, projectId: string, raw: z.input<typeof taskInput>, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const input = taskInput.parse(raw);
  return withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    assertEditable(project);
    await validateTaskRefs(tx, projectId, input);
    const [task] = await tx
      .insert(tasks)
      .values({
        projectId,
        title: input.title,
        description: input.description ?? null,
        milestoneId: input.milestoneId ?? null,
        assignedTo: input.assignedTo ?? null,
        required: input.required,
        dueDate: input.dueDate ?? null,
        estimateHours: input.estimateHours ?? null,
      })
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: task.id,
      projectId,
      action: "task.created",
      after: taskDetails(task),
      request,
    });
    if (task.assignedTo) {
      await notify(tx, actor, {
        recipientId: task.assignedTo,
        type: "task.assigned",
        title: `New task in ${project.code}`,
        message: `"${task.title}"${task.dueDate ? `, due ${task.dueDate}` : ""}.`,
        entityType: "project",
        entityId: projectId,
      });
    }
    return task;
  });
}

function taskDetails(t: TaskRow) {
  return {
    title: t.title,
    description: t.description,
    milestoneId: t.milestoneId,
    assignedTo: t.assignedTo,
    required: t.required,
    dueDate: t.dueDate,
    estimateHours: t.estimateHours,
  };
}

function taskProgressFields(t: TaskRow) {
  return {
    status: t.status,
    completionNote: t.completionNote,
    completedAt: t.completedAt,
    evidenceUrl: t.evidenceUrl,
    blockedReason: t.blockedReason,
    blockedNeeds: t.blockedNeeds,
    waivedReason: t.waivedReason,
  };
}

export async function updateTaskDetails(actor: Actor, taskId: string, raw: z.input<typeof taskInput>, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const input = taskInput.parse(raw);
  await withActor(actor, async (tx) => {
    const [current] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!current) throw new ServiceError("Task not found.");
    const project = await lockProject(tx, current.projectId);
    assertEditable(project);
    await validateTaskRefs(tx, project.id, input);
    const [updated] = await tx
      .update(tasks)
      .set({
        title: input.title,
        description: input.description ?? null,
        milestoneId: input.milestoneId ?? null,
        assignedTo: input.assignedTo ?? null,
        required: input.required,
        dueDate: input.dueDate ?? null,
        estimateHours: input.estimateHours ?? null,
      })
      .where(eq(tasks.id, taskId))
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: taskId,
      projectId: project.id,
      action: "task.updated",
      before: taskDetails(current),
      after: taskDetails(updated),
      request,
    });
    if (updated.assignedTo && updated.assignedTo !== current.assignedTo) {
      await notify(tx, actor, {
        recipientId: updated.assignedTo,
        type: "task.assigned",
        title: `New task in ${project.code}`,
        message: `"${updated.title}" was assigned to you.`,
        entityType: "project",
        entityId: project.id,
      });
    }
  });
}

const note = (message: string) => z.string().trim().min(3, message).max(2000);

export const progressInput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NOT_STARTED") }),
  z.object({ status: z.literal("IN_PROGRESS") }),
  z.object({ status: z.literal("IN_REVIEW") }),
  z.object({ status: z.literal("READY_FOR_QA") }),
  z.object({
    status: z.literal("DONE"),
    completionNote: note("Describe what was completed (at least 3 characters)."),
    completedOn: z.iso.date("Enter the completion date"),
    evidenceUrl: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.url({ protocol: /^https?$/, message: "Evidence must be an http(s) link" }).nullable())
      .nullish(),
  }),
  z.object({
    status: z.literal("BLOCKED"),
    blockedReason: note("Explain what is blocking the task."),
    blockedNeeds: note("Say what is needed to continue."),
  }),
]);

/** Members record progress on their own tasks; PMs/Admins on any task. */
export async function updateTaskProgress(
  actor: Actor,
  taskId: string,
  raw: z.input<typeof progressInput>,
  request?: RequestMeta,
) {
  const input = progressInput.parse(raw);
  if (input.status === "DONE" && input.completedOn > todayInOperatingZone()) {
    throw new ServiceError("The completion date cannot be in the future.");
  }
  await withActor(actor, async (tx) => {
    const [current] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!current) throw new ServiceError("Task not found.");
    assertCan(actor, "task.update", { isTaskAssignee: current.assignedTo === actor.id });
    const [project] = await tx.select().from(projects).where(eq(projects.id, current.projectId));
    if (!project || !acceptsTaskUpdates(project.status)) {
      throw new ServiceError("Progress can't be recorded while the project is in this state.");
    }
    if (current.status === "WAIVED" && !can(actor, "project.edit")) {
      throw new ServiceError("This task was waived by a project manager.");
    }

    const cleared = {
      completionNote: null,
      completedAt: null,
      completedBy: null,
      evidenceUrl: null,
      blockedReason: null,
      blockedNeeds: null,
      waivedReason: null,
    };
    const changes =
      input.status === "DONE"
        ? {
            ...cleared,
            status: input.status,
            completionNote: input.completionNote,
            completedAt: new Date(`${input.completedOn}T12:00:00Z`),
            completedBy: actor.id,
            evidenceUrl: input.evidenceUrl ?? null,
          }
        : input.status === "BLOCKED"
          ? { ...cleared, status: input.status, blockedReason: input.blockedReason, blockedNeeds: input.blockedNeeds }
          : { ...cleared, status: input.status };

    const [updated] = await tx.update(tasks).set(changes).where(eq(tasks.id, taskId)).returning();
    if (!updated) throw new ServiceError("You can only update tasks assigned to you.");
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: taskId,
      projectId: project.id,
      action: "task.progress_updated",
      before: taskProgressFields(current),
      after: taskProgressFields(updated),
      request,
    });
    if (input.status === "BLOCKED" || input.status === "DONE") {
      await notify(tx, actor, {
        recipientId: project.projectOwnerId,
        type: input.status === "BLOCKED" ? "task.blocked" : "task.done",
        title: input.status === "BLOCKED" ? `Task blocked in ${project.code}` : `Task done in ${project.code}`,
        message:
          input.status === "BLOCKED"
            ? `"${updated.title}": ${input.blockedReason} Needs: ${input.blockedNeeds}`
            : `"${updated.title}" was marked done.`,
        entityType: "project",
        entityId: project.id,
      });
    }
  });
}

export async function waiveTask(actor: Actor, taskId: string, reason: string, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const why = note("Give a reason for waiving the task.").parse(reason);
  await withActor(actor, async (tx) => {
    const [current] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!current) throw new ServiceError("Task not found.");
    const project = await lockProject(tx, current.projectId);
    assertEditable(project);
    if (current.status === "WAIVED") return;
    const [updated] = await tx
      .update(tasks)
      .set({ status: "WAIVED", waivedReason: why, blockedReason: null, blockedNeeds: null })
      .where(eq(tasks.id, taskId))
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "task",
      entityId: taskId,
      projectId: project.id,
      action: "task.waived",
      before: taskProgressFields(current),
      after: taskProgressFields(updated),
      reason: why,
      request,
    });
  });
}
