import { and, asc, count, desc, eq, inArray, ne, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import {
  auditEvents,
  organizations,
  compensationSnapshotLines,
  compensationSnapshots,
  paymentTransactions,
  payoutLedgerEntries,
  projectAssignments,
  projects,
  tasks,
  users,
  orgMembers,
} from "@/lib/db/schema";
import { formatMoney, formatPercent } from "@/lib/money";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { CALCULATION_VERSION } from "@/modules/compensation/calculate";
import { ServiceError } from "@/modules/errors";
import { notify } from "@/modules/notifications";
import { lockProject, previewCompensationTx } from "@/modules/projects";
import { approvalReadiness } from "./readiness";

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(1000);
const optionalNote = z
  .string()
  .trim()
  .max(1000)
  .transform((v) => (v === "" ? null : v))
  .nullish();

/** Postgres errors raised by our guard functions carry a safe message. */
function rethrowGuard(error: unknown): never {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "23514" || cause?.code === "42501") {
    throw new ServiceError(cause.message ?? "Not allowed.");
  }
  throw error;
}

async function managersAndOwner(tx: Tx, project: { projectOwnerId: string }) {
  const managers = await tx
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.active, true), or(eq(orgMembers.role, "PROJECT_MANAGER"), eq(orgMembers.role, "ADMIN"))));
  return [...new Set([project.projectOwnerId, ...managers.map((m) => m.id)])];
}

async function teamMemberIds(tx: Tx, projectId: string) {
  const rows = await tx.execute<{ member_id: string }>(sql`select member_id from app_project_team(${projectId})`);
  return [...new Set(rows.rows.map((r) => r.member_id))];
}

/**
 * Phase 28, two people for money: unless the company allows it (small teams), nobody approves a
 * project that pays them, or that they asked to have approved. Returns why, or null.
 */
async function selfApprovalBlock(tx: Tx, actor: Actor, projectId: string, payees: { memberId: string; amountMinor: number }[]): Promise<string | null> {
  const [org] = await tx.select({ allow: organizations.allowSelfApproval }).from(organizations).where(eq(organizations.id, actor.orgId));
  if (org?.allow) return null;
  const tail = " A company with only one manager can allow this on the Company page.";
  if (payees.some((p) => p.memberId === actor.id && p.amountMinor > 0)) {
    return `You are paid on this project, so someone else must approve it.${tail}`;
  }
  const [requested] = await tx
    .select({ actorId: auditEvents.actorId })
    .from(auditEvents)
    .where(and(eq(auditEvents.projectId, projectId), eq(auditEvents.action, "project.approval_requested")))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  if (requested?.actorId === actor.id) return `You asked for this approval, so someone else must approve it.${tail}`;
  return null;
}

/** For the project page: why this person can't approve the project (or null). */
export async function approvalBlockFor(actor: Actor, projectId: string): Promise<string | null> {
  return withActor(actor, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    const plan = await previewCompensationTx(tx, project);
    return selfApprovalBlock(tx, actor, projectId, plan.lines);
  });
}

/** Members (for their own projects) and managers ask for the work to be approved. */
export async function requestApproval(actor: Actor, projectId: string, note?: string | null, request?: RequestMeta) {
  const message = optionalNote.parse(note);
  await withActor(actor, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project) throw new ServiceError("Project not found.");
    // Visible through row-level security means the actor is a manager or on the project.
    assertCan(actor, "project.requestApproval", { isProjectMember: true });
    try {
      await tx.execute(sql`select app_request_approval(${projectId})`);
    } catch (error) {
      rethrowGuard(error);
    }
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.approval_requested",
      before: { status: project.status },
      after: { status: "PENDING_APPROVAL" },
      reason: message,
      request,
    });
    for (const recipientId of await managersAndOwner(tx, project)) {
      await notify(tx, actor, {
        recipientId,
        type: "approval.requested",
        title: `Approval requested for ${project.code}`,
        message: `"${project.name}" is ready for review.${message ? ` Note: ${message}` : ""}`,
        entityType: "project",
        entityId: projectId,
      });
    }
  });
}

export const approveInput = z.object({
  /** The project version the approver reviewed; a later change makes the approval fail. */
  expectedVersion: z.coerce.number().int(),
  overrideReason: optionalNote,
});

export type ApprovalResult = { snapshotId: string; sequence: number; ledgerEntries: number; allocatedMinor: number };

/**
 * The approval transaction (design doc 5.2): lock the project, verify state and plan, freeze the
 * compensation snapshot, create one ledger entry per recipient with a non-zero amount, audit, and
 * complete the project. All or nothing. A retry or a second approver finds the project already
 * completed and changes nothing.
 */
export async function approveProject(
  actor: Actor,
  projectId: string,
  raw: z.input<typeof approveInput>,
  request?: RequestMeta,
): Promise<ApprovalResult> {
  assertCan(actor, "project.approve");
  const input = approveInput.parse(raw);
  return withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    if (project.status === "COMPLETED") throw new ServiceError("This project has already been approved.");
    if (project.status !== "PENDING_APPROVAL") {
      throw new ServiceError("Only a project waiting for approval can be approved.");
    }
    if (project.version !== input.expectedVersion) {
      throw new ServiceError("The project changed since you opened it. Reload and review it again before approving.");
    }

    const plan = await previewCompensationTx(tx, project);
    const blocked = await selfApprovalBlock(tx, actor, projectId, plan.lines);
    if (blocked) throw new ServiceError(blocked);
    const taskRows = await tx
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, required: tasks.required })
      .from(tasks)
      .where(eq(tasks.projectId, projectId));
    const readiness = approvalReadiness(plan, taskRows);
    if (readiness.blockers.length > 0) throw new ServiceError(readiness.blockers.join(" "));
    if (readiness.incompleteTasks.length > 0 && !input.overrideReason) {
      throw new ServiceError(
        `${readiness.incompleteTasks.length} required task(s) are not done or waived. Give an override reason to approve anyway.`,
      );
    }

    const [{ value: previous }] = await tx
      .select({ value: count() })
      .from(compensationSnapshots)
      .where(eq(compensationSnapshots.projectId, projectId));
    const notes = [
      plan.roundingNote,
      plan.agodShareMinor > 0
        ? project.splitMode === "PERCENTAGE"
          ? `Company share (${formatPercent(project.agodShareBasisPoints)}): ${formatMoney(plan.agodShareMinor, project.currency)}.`
          : `Not allocated to the team, kept by the company: ${formatMoney(plan.agodShareMinor, project.currency)}.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");

    const [snapshot] = await tx
      .insert(compensationSnapshots)
      .values({
        projectId,
        sequence: previous + 1,
        projectTotalValueMinor: project.totalValueMinor,
        currency: project.currency,
        splitMode: project.splitMode,
        agodShareBasisPoints: project.agodShareBasisPoints,
        agodShareMinor: plan.agodShareMinor,
        calculationVersion: CALCULATION_VERSION,
        calculationNotes: notes || null,
        createdBy: actor.id,
      })
      .returning();

    const assignments = await tx
      .select({ id: projectAssignments.id, rationale: projectAssignments.rationale })
      .from(projectAssignments)
      .where(inArray(projectAssignments.id, plan.lines.map((l) => l.assignmentId)));
    const lines = await tx
      .insert(compensationSnapshotLines)
      .values(
        plan.lines.map((line) => ({
          snapshotId: snapshot.id,
          memberId: line.memberId,
          roleOnProject: line.roleOnProject,
          sourceAssignmentId: line.assignmentId,
          splitType: line.splitType,
          splitBasisPoints: line.splitBasisPoints,
          splitAmountMinor: line.splitAmountMinor,
          amountOwedMinor: line.amountMinor,
          currency: project.currency,
          rationale: assignments.find((a) => a.id === line.assignmentId)?.rationale ?? null,
        })),
      )
      .returning();

    const approvedAt = new Date();
    const payable = lines.filter((line) => line.amountOwedMinor > 0);
    if (payable.length > 0) {
      await tx.insert(payoutLedgerEntries).values(
        payable.map((line) => ({
          projectId,
          snapshotLineId: line.id,
          memberId: line.memberId,
          amountOwedMinor: line.amountOwedMinor,
          currency: line.currency,
          approvedBy: actor.id,
          approvedAt,
        })),
      );
    }

    try {
      await tx
        .update(projects)
        .set({
          status: "COMPLETED",
          approvedBy: actor.id,
          approvedAt,
          completedAt: approvedAt,
          version: project.version + 1,
        })
        .where(eq(projects.id, projectId));
    } catch (error) {
      rethrowGuard(error);
    }

    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.approved",
      before: { status: project.status },
      after: {
        status: "COMPLETED",
        snapshotId: snapshot.id,
        sequence: snapshot.sequence,
        totalValueMinor: project.totalValueMinor,
        allocatedMinor: plan.allocatedMinor,
        agodShareBasisPoints: project.agodShareBasisPoints,
        agodShareMinor: plan.agodShareMinor,
        unallocatedMinor: plan.unallocatedMinor,
        lines: lines.map((l) => ({ memberId: l.memberId, role: l.roleOnProject, amountOwedMinor: l.amountOwedMinor })),
        overriddenTasks: readiness.incompleteTasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      },
      reason: input.overrideReason ?? null,
      request,
    });

    for (const line of payable) {
      await notify(tx, actor, {
        recipientId: line.memberId,
        type: "payout.created",
        title: `Payout approved for ${project.code}`,
        message: `${formatMoney(line.amountOwedMinor, line.currency)} for your work on "${project.name}" as ${line.roleOnProject}.`,
        entityType: "project",
        entityId: projectId,
      });
    }
    await notify(tx, actor, {
      recipientId: project.projectOwnerId,
      type: "project.approved",
      title: `${project.code} approved`,
      message: `"${project.name}" was approved and payouts were created.`,
      entityType: "project",
      entityId: projectId,
    });

    return { snapshotId: snapshot.id, sequence: snapshot.sequence, ledgerEntries: payable.length, allocatedMinor: plan.allocatedMinor };
  });
}

export async function rejectProject(actor: Actor, projectId: string, rawReason: string, request?: RequestMeta) {
  assertCan(actor, "project.reject");
  const why = reason.parse(rawReason);
  await withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    if (project.status !== "PENDING_APPROVAL") throw new ServiceError("Only a project waiting for approval can be returned.");
    await tx
      .update(projects)
      .set({ status: "CHANGES_REQUESTED", version: project.version + 1 })
      .where(eq(projects.id, projectId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.changes_requested",
      before: { status: project.status },
      after: { status: "CHANGES_REQUESTED" },
      reason: why,
      request,
    });
    for (const recipientId of new Set([project.projectOwnerId, ...(await teamMemberIds(tx, projectId))])) {
      await notify(tx, actor, {
        recipientId,
        type: "approval.changes_requested",
        title: `Changes requested on ${project.code}`,
        message: why,
        entityType: "project",
        entityId: projectId,
      });
    }
  });
}

/**
 * Admin-only (decision 5). Voids the current payout entries (never deletes them), keeps the
 * snapshot as history and returns the project to work. Refused once any payment was recorded:
 * corrections after payment are adjustments.
 */
export async function reopenProject(actor: Actor, projectId: string, rawReason: string, request?: RequestMeta) {
  assertCan(actor, "project.reopen");
  const why = reason.parse(rawReason);
  await withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    if (project.status !== "COMPLETED") throw new ServiceError("Only an approved project can be reopened.");

    const entries = await tx
      .select()
      .from(payoutLedgerEntries)
      .where(and(eq(payoutLedgerEntries.projectId, projectId), ne(payoutLedgerEntries.status, "VOIDED")));
    if (entries.length > 0) {
      const [paid] = await tx
        .select({ value: count() })
        .from(paymentTransactions)
        .where(inArray(paymentTransactions.ledgerEntryId, entries.map((e) => e.id)));
      if (paid.value > 0) {
        throw new ServiceError("Payments were already recorded for this project. Use an adjustment instead of reopening.");
      }
      await tx
        .update(payoutLedgerEntries)
        .set({ status: "VOIDED", notes: `Voided when the project was reopened: ${why}` })
        .where(inArray(payoutLedgerEntries.id, entries.map((e) => e.id)));
    }

    try {
      await tx
        .update(projects)
        .set({ status: "IN_PROGRESS", approvedBy: null, approvedAt: null, completedAt: null, version: project.version + 1 })
        .where(eq(projects.id, projectId));
    } catch (error) {
      rethrowGuard(error);
    }
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.reopened",
      before: { status: project.status, ledgerEntries: entries.map((e) => ({ id: e.id, memberId: e.memberId, amountOwedMinor: e.amountOwedMinor })) },
      after: { status: "IN_PROGRESS", voidedEntries: entries.length },
      reason: why,
      request,
    });
    for (const entry of entries) {
      await notify(tx, actor, {
        recipientId: entry.memberId,
        type: "payout.voided",
        title: `${project.code} reopened`,
        message: `Your payout of ${formatMoney(entry.amountOwedMinor, entry.currency)} was voided because the project was reopened: ${why}`,
        entityType: "project",
        entityId: projectId,
      });
    }
  });
}

/** Snapshots and their lines/ledger state for a project (members see only their own lines). */
export async function getProjectPayouts(actor: Actor, projectId: string) {
  return withActor(actor, async (tx) => {
    const snapshots = await tx
      .select({ snapshot: compensationSnapshots, approverName: users.name })
      .from(compensationSnapshots)
      .innerJoin(users, eq(users.id, compensationSnapshots.createdBy))
      .where(eq(compensationSnapshots.projectId, projectId))
      .orderBy(asc(compensationSnapshots.sequence));
    if (snapshots.length === 0) return [];
    const lines = await tx
      .select({ line: compensationSnapshotLines, memberName: users.name, entry: payoutLedgerEntries })
      .from(compensationSnapshotLines)
      .innerJoin(users, eq(users.id, compensationSnapshotLines.memberId))
      .leftJoin(payoutLedgerEntries, eq(payoutLedgerEntries.snapshotLineId, compensationSnapshotLines.id))
      .where(inArray(compensationSnapshotLines.snapshotId, snapshots.map((s) => s.snapshot.id)))
      .orderBy(asc(compensationSnapshotLines.createdAt));
    return snapshots.map(({ snapshot, approverName }) => ({
      ...snapshot,
      approverName,
      lines: lines
        .filter((l) => l.line.snapshotId === snapshot.id)
        .map((l) => ({ ...l.line, memberName: l.memberName, ledgerStatus: l.entry?.status ?? null, ledgerEntryId: l.entry?.id ?? null })),
    }));
  });
}
