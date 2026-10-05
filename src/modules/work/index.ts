import { and, desc, eq, inArray } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import {
  auditEvents,
  milestones,
  notifications,
  projectAssignments,
  projects,
  tasks,
} from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import type { Actor } from "@/lib/permissions";
import { ledgerRowsTx, ledgerTotals } from "@/modules/ledger";
import {
  isTaskOverdue,
  personalProgress,
  projectHealth,
  projectProgress,
} from "@/modules/projects/rules";

/**
 * My Work (design doc section 8): what is assigned to me, what have I completed, what am I owed.
 * Project progress uses the same function and data as the project workspace, so they always match.
 */
export async function getMyWork(actor: Actor) {
  return withActor(actor, async (tx) => {
    const today = todayInOperatingZone();

    const myTasks = await tx
      .select({ task: tasks, projectName: projects.name, projectCode: projects.code, projectStatus: projects.status })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.assignedTo, actor.id))
      .orderBy(desc(tasks.updatedAt));

    const myAssignments = await tx
      .select()
      .from(projectAssignments)
      .where(and(eq(projectAssignments.memberId, actor.id), eq(projectAssignments.active, true)));

    const projectIds = new Set([...myTasks.map((t) => t.task.projectId), ...myAssignments.map((a) => a.projectId)]);
    const ownedProjects = await tx.select({ id: projects.id }).from(projects).where(eq(projects.projectOwnerId, actor.id));
    for (const p of ownedProjects) projectIds.add(p.id);
    const ids = [...projectIds];

    const projectRows = ids.length ? await tx.select().from(projects).where(inArray(projects.id, ids)) : [];
    const allTasks = ids.length
      ? await tx
          .select({ projectId: tasks.projectId, status: tasks.status, required: tasks.required, dueDate: tasks.dueDate })
          .from(tasks)
          .where(inArray(tasks.projectId, ids))
      : [];

    const taskList = myTasks.map(({ task, projectName, projectCode, projectStatus }) => ({
      ...task,
      projectName,
      projectCode,
      projectStatus,
      overdue: isTaskOverdue(task, today),
    }));
    const active = taskList.filter((t) => t.status !== "WAIVED");

    const summary = {
      assigned: active.length,
      completed: active.filter((t) => t.status === "DONE").length,
      inProgress: active.filter((t) => t.status === "IN_PROGRESS").length,
      blocked: active.filter((t) => t.status === "BLOCKED").length,
      overdue: active.filter((t) => t.overdue).length,
      progress: personalProgress(taskList),
    };

    const currentProjects = projectRows
      .filter((p) => p.status !== "COMPLETED" && p.status !== "CANCELLED")
      .map((p) => {
        const projectTasks = allTasks.filter((t) => t.projectId === p.id);
        const mine = taskList.filter((t) => t.projectId === p.id);
        const roles = myAssignments.filter((a) => a.projectId === p.id).map((a) => a.roleOnProject);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          status: p.status,
          targetDate: p.targetDate,
          myRoles: roles.length ? roles : p.projectOwnerId === actor.id ? ["Project owner"] : [],
          projectProgress: projectProgress(projectTasks),
          myProgress: personalProgress(mine),
          health: projectHealth(p, projectTasks, today),
        };
      });

    const completedMilestones = ids.length
      ? await tx
          .select({ milestone: milestones, projectCode: projects.code })
          .from(milestones)
          .innerJoin(projects, eq(projects.id, milestones.projectId))
          .where(and(inArray(milestones.projectId, ids), eq(milestones.status, "COMPLETED")))
      : [];

    // Payouts: own ledger entries only (row-level security), with balances after adjustments.
    const ledgerRows = await ledgerRowsTx(tx, { memberId: actor.id });
    const payoutRows = ledgerRows.map((r) => ({
      id: r.id,
      projectCode: r.projectCode,
      projectName: r.projectName,
      status: r.status,
      currency: r.currency,
      owedMinor: r.effectiveOwedMinor,
      paidMinor: r.paidMinor,
      remainingMinor: r.remainingMinor,
    }));
    const totals = ledgerTotals(ledgerRows);
    const payouts = { rows: payoutRows, owedMinor: totals.owedMinor, paidMinor: totals.paidMinor, remainingMinor: totals.remainingMinor };

    // Timeline: my own recorded actions plus notifications about things done to/for me.
    const myEvents = await tx
      .select({ event: auditEvents, projectCode: projects.code })
      .from(auditEvents)
      .leftJoin(projects, eq(projects.id, auditEvents.projectId))
      .where(eq(auditEvents.actorId, actor.id))
      .orderBy(desc(auditEvents.createdAt))
      .limit(30);
    const myNotifications = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, actor.id))
      .orderBy(desc(notifications.createdAt))
      .limit(30);

    const timeline = [
      ...myEvents.map(({ event, projectCode }) => ({
        id: event.id,
        at: event.createdAt,
        kind: "action" as const,
        text: event.action,
        projectCode,
        reason: event.reason,
      })),
      ...myNotifications.map((n) => ({
        id: n.id,
        at: n.createdAt,
        kind: "notification" as const,
        text: `${n.title}: ${n.message}`,
        projectCode: null,
        reason: null,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 30);

    return {
      today,
      summary,
      currentProjects,
      tasks: taskList,
      completedTasks: taskList.filter((t) => t.status === "DONE"),
      completedMilestones: completedMilestones.map((m) => ({ ...m.milestone, projectCode: m.projectCode })),
      payouts,
      unreadNotifications: myNotifications.filter((n) => !n.readAt),
      timeline,
    };
  });
}

