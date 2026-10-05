import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import {
  auditEvents,
  milestones,
  projectAssignments,
  projects,
  tasks,
  users,
} from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { DEFAULT_CURRENCY, parseMoney } from "@/lib/money";
import { type Actor, assertCan, can } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { type PlanResult, calculateCompensation } from "@/modules/compensation/calculate";
import { approvalReadiness } from "@/modules/approvals/readiness";
import { ServiceError } from "@/modules/errors";
import {
  type Health,
  type Progress,
  type ProjectStatus,
  canTransition,
  isEditable,
  projectHealth,
  projectProgress,
} from "./rules";

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === "" ? null : v))
  .nullish();
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.iso.date("Use a valid date").nullable())
  .nullish();

export const projectInput = z
  .object({
    name: z.string().trim().min(2, "Project name is required").max(200),
    description: optionalText,
    clientType: z.enum(["INTERNAL", "EXTERNAL"]),
    clientName: optionalText,
    totalValue: z.string().transform((v, ctx) => {
      const minor = parseMoney(v);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: "Enter the project value in GHS, e.g. 12500.00" });
        return z.NEVER;
      }
      return minor;
    }),
    splitMode: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    projectOwnerId: z.uuid("Choose a project owner"),
    startDate: optionalDate,
    targetDate: optionalDate,
  })
  .refine((p) => !p.startDate || !p.targetDate || p.targetDate >= p.startDate, {
    message: "The target date cannot be before the start date.",
  })
  .refine((p) => p.clientType === "INTERNAL" || !!p.clientName, {
    message: "Enter the client name for an external project.",
  });

export type ProjectInput = z.input<typeof projectInput>;

async function assertActiveUser(tx: Tx, userId: string, what: string) {
  const [user] = await tx.select({ active: users.active }).from(users).where(eq(users.id, userId));
  if (!user) throw new ServiceError(`${what} not found.`);
  if (!user.active) throw new ServiceError(`${what} is inactive and cannot be given new work.`);
}

/** Human-readable code AGOD-<year>-<nnn>, sequential per year. */
async function nextProjectCode(tx: Tx): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agod_project_code'))`);
  const year = todayInOperatingZone().slice(0, 4);
  const prefix = `AGOD-${year}-`;
  const [row] = await tx
    .select({ max: sql<string | null>`max(${projects.code})` })
    .from(projects)
    .where(sql`${projects.code} like ${prefix + "%"}`);
  const last = row?.max ? Number(row.max.slice(prefix.length)) : 0;
  return `${prefix}${String(last + 1).padStart(3, "0")}`;
}

export async function createProject(actor: Actor, raw: ProjectInput, request?: RequestMeta) {
  assertCan(actor, "project.create");
  const input = projectInput.parse(raw);
  return withActor(actor, async (tx) => {
    await assertActiveUser(tx, input.projectOwnerId, "The project owner");
    const code = await nextProjectCode(tx);
    const [project] = await tx
      .insert(projects)
      .values({
        code,
        name: input.name,
        description: input.description ?? null,
        clientType: input.clientType,
        clientName: input.clientType === "EXTERNAL" ? (input.clientName ?? null) : null,
        totalValueMinor: input.totalValue,
        currency: DEFAULT_CURRENCY,
        splitMode: input.splitMode,
        projectOwnerId: input.projectOwnerId,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
      action: "project.created",
      after: auditableProject(project),
      request,
    });
    return project;
  });
}

type ProjectRow = typeof projects.$inferSelect;

function auditableProject(p: ProjectRow) {
  return {
    name: p.name,
    description: p.description,
    clientType: p.clientType,
    clientName: p.clientName,
    totalValueMinor: p.totalValueMinor,
    currency: p.currency,
    splitMode: p.splitMode,
    projectOwnerId: p.projectOwnerId,
    startDate: p.startDate,
    targetDate: p.targetDate,
    status: p.status,
  };
}

/** Loads and row-locks a project the actor can see; null-safe "not found" for hidden rows. */
export async function lockProject(tx: Tx, projectId: string): Promise<ProjectRow> {
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  if (!project) throw new ServiceError("Project not found.");
  return project;
}

export function assertEditable(project: ProjectRow) {
  if (!isEditable(project.status)) {
    throw new ServiceError("This project is locked: changes are not allowed after approval is requested.");
  }
}

export async function updateProject(
  actor: Actor,
  projectId: string,
  raw: ProjectInput & { version: number },
  request?: RequestMeta,
) {
  assertCan(actor, "project.edit");
  const input = projectInput.parse(raw);
  return withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    assertEditable(project);
    if (project.version !== Number(raw.version)) {
      throw new ServiceError("Someone else changed this project meanwhile. Reload the page and try again.");
    }
    if (input.splitMode !== project.splitMode) {
      const [other] = await tx
        .select({ id: projectAssignments.id })
        .from(projectAssignments)
        .where(and(eq(projectAssignments.projectId, projectId), eq(projectAssignments.active, true)))
        .limit(1);
      if (other) {
        throw new ServiceError("Remove the current team splits before switching between percentage and fixed amounts.");
      }
    }
    if (input.projectOwnerId !== project.projectOwnerId) {
      await assertActiveUser(tx, input.projectOwnerId, "The project owner");
    }
    const [updated] = await tx
      .update(projects)
      .set({
        name: input.name,
        description: input.description ?? null,
        clientType: input.clientType,
        clientName: input.clientType === "EXTERNAL" ? (input.clientName ?? null) : null,
        totalValueMinor: input.totalValue,
        splitMode: input.splitMode,
        projectOwnerId: input.projectOwnerId,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        version: project.version + 1,
      })
      .where(eq(projects.id, projectId))
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.updated",
      before: auditableProject(project),
      after: auditableProject(updated),
      request,
    });
    return updated;
  });
}

export const statusChangeInput = z.object({
  to: z.enum(["DRAFT", "PLANNING", "IN_PROGRESS", "CANCELLED"]),
  reason: optionalText,
});

export async function changeProjectStatus(
  actor: Actor,
  projectId: string,
  raw: z.input<typeof statusChangeInput>,
  request?: RequestMeta,
) {
  assertCan(actor, "project.edit");
  const input = statusChangeInput.parse(raw);
  if (input.to === "CANCELLED" && !input.reason) throw new ServiceError("Give a reason for cancelling.");
  await withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    if (!canTransition(project.status, input.to)) {
      throw new ServiceError(`A project cannot move from ${project.status} to ${input.to} here.`);
    }
    await tx
      .update(projects)
      .set({ status: input.to, version: project.version + 1 })
      .where(eq(projects.id, projectId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.status_changed",
      before: { status: project.status },
      after: { status: input.to },
      reason: input.reason ?? null,
      request,
    });
  });
}

export type ProjectSummary = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  clientType: "INTERNAL" | "EXTERNAL";
  clientName: string | null;
  totalValueMinor: number;
  currency: string;
  ownerName: string;
  targetDate: string | null;
  progress: Progress;
  health: Health | null;
};

export const projectFilters = z.object({
  q: z.string().trim().max(100).optional(),
  status: z
    .enum(["DRAFT", "PLANNING", "IN_PROGRESS", "PENDING_APPROVAL", "CHANGES_REQUESTED", "COMPLETED", "CANCELLED"])
    .optional()
    .catch(undefined),
});

/** Projects the actor can see (all for managers; their own for members, via row-level security). */
export async function listProjects(actor: Actor, raw: z.input<typeof projectFilters> = {}): Promise<ProjectSummary[]> {
  const filters = projectFilters.parse(raw);
  return withActor(actor, async (tx) => {
    const conditions = [];
    if (filters.status) conditions.push(eq(projects.status, filters.status));
    if (filters.q) {
      const like = `%${filters.q.replace(/[%_\\]/g, "\\$&")}%`;
      conditions.push(or(ilike(projects.name, like), ilike(projects.code, like), ilike(projects.clientName, like)));
    }
    const rows = await tx
      .select({ project: projects, ownerName: users.name })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.projectOwnerId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(projects.createdAt));
    if (rows.length === 0) return [];

    const taskRows = await tx
      .select({ projectId: tasks.projectId, status: tasks.status, required: tasks.required, dueDate: tasks.dueDate })
      .from(tasks)
      .where(inArray(tasks.projectId, rows.map((r) => r.project.id)));
    const today = todayInOperatingZone();

    return rows.map(({ project, ownerName }) => {
      const own = taskRows.filter((t) => t.projectId === project.id);
      return {
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        clientType: project.clientType,
        clientName: project.clientName,
        totalValueMinor: project.totalValueMinor,
        currency: project.currency,
        ownerName,
        targetDate: project.targetDate,
        progress: projectProgress(own),
        health: projectHealth(project, own, today),
      };
    });
  });
}

export type TeamEntry = {
  assignmentId: string;
  memberId: string;
  memberName: string;
  memberActive: boolean;
  roleOnProject: string;
  /** Present only for managers, and for the member's own assignment. */
  split: { type: "PERCENTAGE" | "FIXED_AMOUNT"; basisPoints: number | null; amountMinor: number | null; rationale: string | null } | null;
};

export async function getProjectWorkspace(actor: Actor, projectId: string) {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ project: projects, ownerName: users.name })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.projectOwnerId))
      .where(eq(projects.id, projectId));
    // Row-level security hides projects the actor doesn't belong to: same answer as "doesn't exist".
    if (!row) return null;
    assertCan(actor, "project.view", { isProjectMember: true });
    const isManager = can(actor, "project.configureCompensation");

    const team = await loadTeam(tx, projectId, isManager);
    const milestoneRows = await tx
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(asc(milestones.sequence));
    const taskRows = await tx
      .select({ task: tasks, assigneeName: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assignedTo))
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.createdAt));
    const today = todayInOperatingZone();
    const progressTasks = taskRows.map((t) => t.task);

    let compensation: PlanResult | null = null;
    if (isManager) compensation = await previewCompensationTx(tx, row.project);

    const activity = await tx
      .select({ event: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(eq(auditEvents.projectId, projectId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(50);

    const readiness = compensation
      ? approvalReadiness(compensation, taskRows.map((t) => t.task))
      : approvalReadiness(
          { valid: true, errors: [], lines: [], allocatedMinor: 0, unallocatedMinor: 0, roundingNote: null },
          taskRows.map((t) => t.task),
        );

    return {
      project: row.project,
      ownerName: row.ownerName,
      readiness,
      team,
      milestones: milestoneRows,
      tasks: taskRows.map((t) => ({ ...t.task, assigneeName: t.assigneeName })),
      progress: projectProgress(progressTasks),
      health: projectHealth(row.project, progressTasks, today),
      today,
      compensation,
      activity: activity.map((a) => ({ ...a.event, actorName: a.actorName })),
    };
  });
}

async function loadTeam(tx: Tx, projectId: string, isManager: boolean): Promise<TeamEntry[]> {
  if (isManager) {
    const rows = await tx
      .select({ a: projectAssignments, name: users.name, active: users.active })
      .from(projectAssignments)
      .innerJoin(users, eq(users.id, projectAssignments.memberId))
      .where(and(eq(projectAssignments.projectId, projectId), eq(projectAssignments.active, true)))
      .orderBy(asc(projectAssignments.createdAt));
    return rows.map(({ a, name, active }) => ({
      assignmentId: a.id,
      memberId: a.memberId,
      memberName: name,
      memberActive: active,
      roleOnProject: a.roleOnProject,
      split: { type: a.splitType, basisPoints: a.splitBasisPoints, amountMinor: a.splitAmountMinor, rationale: a.rationale },
    }));
  }
  // Members: names and roles for everyone, split only for their own rows.
  const team = await tx.execute<{
    assignment_id: string;
    member_id: string;
    member_name: string;
    role_on_project: string;
  }>(sql`select * from app_project_team(${projectId})`);
  const own = await tx.select().from(projectAssignments).where(eq(projectAssignments.projectId, projectId));
  return team.rows.map((t) => {
    const mine = own.find((a) => a.id === t.assignment_id);
    return {
      assignmentId: t.assignment_id,
      memberId: t.member_id,
      memberName: t.member_name,
      memberActive: true,
      roleOnProject: t.role_on_project,
      split: mine
        ? { type: mine.splitType, basisPoints: mine.splitBasisPoints, amountMinor: mine.splitAmountMinor, rationale: mine.rationale }
        : null,
    };
  });
}

export async function previewCompensationTx(tx: Tx, project: ProjectRow): Promise<PlanResult> {
  const lines = await tx
    .select()
    .from(projectAssignments)
    .where(and(eq(projectAssignments.projectId, project.id), eq(projectAssignments.active, true)))
    .orderBy(asc(projectAssignments.createdAt));
  return calculateCompensation({
    totalValueMinor: project.totalValueMinor,
    currency: project.currency,
    splitMode: project.splitMode,
    lines: lines.map((a) => ({
      assignmentId: a.id,
      memberId: a.memberId,
      roleOnProject: a.roleOnProject,
      splitType: a.splitType,
      splitBasisPoints: a.splitBasisPoints,
      splitAmountMinor: a.splitAmountMinor,
    })),
  });
}

/** Active members for owner/assignee pickers. */
export async function listActiveMembers(actor: Actor) {
  return withActor(actor, (tx) =>
    tx
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name)),
  );
}
