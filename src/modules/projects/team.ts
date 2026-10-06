import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { milestones, projectAssignments, orgMembers } from "@/lib/db/schema";
import { parseMoney, parsePercent } from "@/lib/money";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { isUniqueViolation } from "@/modules/db-errors";
import { ServiceError } from "@/modules/errors";
import { notify } from "@/modules/notifications";
import { assertEditable, lockProject } from ".";

// Team (assignments + compensation splits) and milestones. PM/Admin only, before approval.

const rationale = z
  .string()
  .trim()
  .max(1000)
  .transform((v) => (v === "" ? null : v))
  .nullish();

export const assignmentInput = z.object({
  memberId: z.uuid("Choose a member"),
  roleOnProject: z.string().trim().min(2, "Enter the member's role on the project").max(100),
  /** "33.33" (percent) or "1250.00" (GHS), depending on the project's split mode. */
  split: z.string().trim().min(1, "Enter the split"),
  rationale,
});

function parseSplit(mode: "PERCENTAGE" | "FIXED_AMOUNT", value: string) {
  if (mode === "PERCENTAGE") {
    const bps = parsePercent(value);
    if (bps === null) throw new ServiceError("Enter a percentage between 0 and 100 with up to 2 decimals.");
    return { splitType: mode, splitBasisPoints: bps, splitAmountMinor: null };
  }
  const minor = parseMoney(value);
  if (minor === null) throw new ServiceError("Enter an amount in GHS, e.g. 2500.00");
  return { splitType: mode, splitBasisPoints: null, splitAmountMinor: minor };
}

export async function addAssignment(
  actor: Actor,
  projectId: string,
  raw: z.input<typeof assignmentInput>,
  request?: RequestMeta,
) {
  assertCan(actor, "project.configureCompensation");
  const input = assignmentInput.parse(raw);
  try {
    return await withActor(actor, async (tx) => {
      const project = await lockProject(tx, projectId);
      assertEditable(project);
      const [member] = await tx.select({ active: orgMembers.active, name: orgMembers.name }).from(orgMembers).where(eq(orgMembers.id, input.memberId));
      if (!member) throw new ServiceError("Member not found.");
      if (!member.active) throw new ServiceError("Inactive members cannot be added to projects.");

      const [assignment] = await tx
        .insert(projectAssignments)
        .values({
          projectId,
          memberId: input.memberId,
          roleOnProject: input.roleOnProject,
          rationale: input.rationale ?? null,
          ...parseSplit(project.splitMode, input.split),
        })
        .returning();
      await recordAudit(tx, {
        actorId: actor.id,
        entityType: "project_assignment",
        entityId: assignment.id,
        projectId,
        action: "assignment.added",
        after: assignmentSnapshot(assignment),
        request,
      });
      await notify(tx, actor, {
        recipientId: input.memberId,
        type: "assignment.added",
        title: `Added to ${project.code}`,
        message: `You were added to "${project.name}" as ${input.roleOnProject}.`,
        entityType: "project",
        entityId: projectId,
      });
      return assignment;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ServiceError("This member already has that role on the project.");
    throw error;
  }
}

function assignmentSnapshot(a: typeof projectAssignments.$inferSelect) {
  return {
    memberId: a.memberId,
    roleOnProject: a.roleOnProject,
    splitType: a.splitType,
    splitBasisPoints: a.splitBasisPoints,
    splitAmountMinor: a.splitAmountMinor,
    rationale: a.rationale,
    active: a.active,
  };
}

export const updateAssignmentInput = assignmentInput.omit({ memberId: true });

export async function updateAssignment(
  actor: Actor,
  assignmentId: string,
  raw: z.input<typeof updateAssignmentInput>,
  request?: RequestMeta,
) {
  assertCan(actor, "project.configureCompensation");
  const input = updateAssignmentInput.parse(raw);
  try {
    await withActor(actor, async (tx) => {
      const [current] = await tx.select().from(projectAssignments).where(eq(projectAssignments.id, assignmentId));
      if (!current || !current.active) throw new ServiceError("Team entry not found.");
      const project = await lockProject(tx, current.projectId);
      assertEditable(project);
      const [updated] = await tx
        .update(projectAssignments)
        .set({ roleOnProject: input.roleOnProject, rationale: input.rationale ?? null, ...parseSplit(project.splitMode, input.split) })
        .where(eq(projectAssignments.id, assignmentId))
        .returning();
      await recordAudit(tx, {
        actorId: actor.id,
        entityType: "project_assignment",
        entityId: assignmentId,
        projectId: project.id,
        action: "assignment.updated",
        before: assignmentSnapshot(current),
        after: assignmentSnapshot(updated),
        request,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ServiceError("This member already has that role on the project.");
    throw error;
  }
}

export async function removeAssignment(actor: Actor, assignmentId: string, reason: string, request?: RequestMeta) {
  assertCan(actor, "project.configureCompensation");
  const why = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500).parse(reason);
  await withActor(actor, async (tx) => {
    const [current] = await tx.select().from(projectAssignments).where(eq(projectAssignments.id, assignmentId));
    if (!current || !current.active) throw new ServiceError("Team entry not found.");
    const project = await lockProject(tx, current.projectId);
    assertEditable(project);
    // Deactivated, never deleted: the history of who was on the plan stays visible.
    await tx.update(projectAssignments).set({ active: false }).where(eq(projectAssignments.id, assignmentId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project_assignment",
      entityId: assignmentId,
      projectId: project.id,
      action: "assignment.removed",
      before: assignmentSnapshot(current),
      reason: why,
      request,
    });
  });
}

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.iso.date("Use a valid date").nullable())
  .nullish();

export const milestoneInput = z.object({
  title: z.string().trim().min(2, "Enter a milestone title").max(200),
  description: rationale,
  dueDate: optionalDate,
});

export async function createMilestone(
  actor: Actor,
  projectId: string,
  raw: z.input<typeof milestoneInput>,
  request?: RequestMeta,
) {
  assertCan(actor, "project.edit");
  const input = milestoneInput.parse(raw);
  return withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    assertEditable(project);
    const [row] = await tx
      .select({ last: max(milestones.sequence) })
      .from(milestones)
      .where(eq(milestones.projectId, projectId));
    const [milestone] = await tx
      .insert(milestones)
      .values({
        projectId,
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate ?? null,
        sequence: (row?.last ?? 0) + 1,
      })
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "milestone",
      entityId: milestone.id,
      projectId,
      action: "milestone.created",
      after: { title: milestone.title, dueDate: milestone.dueDate },
      request,
    });
    return milestone;
  });
}

export const milestoneStatusInput = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);

export async function setMilestoneStatus(
  actor: Actor,
  milestoneId: string,
  status: z.input<typeof milestoneStatusInput>,
  request?: RequestMeta,
) {
  assertCan(actor, "project.edit");
  const next = milestoneStatusInput.parse(status);
  await withActor(actor, async (tx) => {
    const [current] = await tx.select().from(milestones).where(eq(milestones.id, milestoneId));
    if (!current) throw new ServiceError("Milestone not found.");
    const project = await lockProject(tx, current.projectId);
    assertEditable(project);
    if (current.status === next) return;
    await tx
      .update(milestones)
      .set({ status: next, completedAt: next === "COMPLETED" ? new Date() : null })
      .where(eq(milestones.id, milestoneId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "milestone",
      entityId: milestoneId,
      projectId: project.id,
      action: "milestone.status_changed",
      before: { status: current.status },
      after: { status: next },
      request,
    });
  });
}

/** Used by the task service: the assignee must be an active member of the project team. */
export async function isOnProjectTeam(
  tx: Parameters<Parameters<typeof withActor>[1]>[0],
  projectId: string,
  memberId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: projectAssignments.id })
    .from(projectAssignments)
    .where(
      and(
        eq(projectAssignments.projectId, projectId),
        eq(projectAssignments.memberId, memberId),
        eq(projectAssignments.active, true),
      ),
    )
    .limit(1);
  return !!row;
}

