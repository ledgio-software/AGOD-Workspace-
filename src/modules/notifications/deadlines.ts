import { and, desc, eq, inArray, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import { auditEvents, notifications, projects, tasks } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import type { Actor } from "@/lib/permissions";

/** Days ahead (inclusive) that count as "due soon". */
export const DUE_SOON_DAYS = 2;

type DeadlineTask = { id: string; title: string; dueDate: string; assignedTo: string | null; projectCode: string; projectId: string };
export type DeadlineAlert = {
  recipientId: string;
  type: "task.due_soon" | "task.overdue" | "task.overdue_owner" | "approval.waiting" | "approval.escalated";
  title: string;
  message: string;
  projectId: string;
  dedupeKey: string;
};

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure: which alerts a user should have for open tasks (roadmap 2.4). The dedupe key includes the
 * due date, so moving a deadline produces a fresh alert, and each alert is otherwise sent once.
 */
export function deadlineAlerts(userId: string, assigned: DeadlineTask[], ownedOverdue: DeadlineTask[], today: string): DeadlineAlert[] {
  const soonLimit = addDays(today, DUE_SOON_DAYS);
  const alerts: DeadlineAlert[] = [];
  for (const t of assigned) {
    if (t.dueDate < today) {
      alerts.push({
        recipientId: userId,
        type: "task.overdue",
        title: `Overdue: ${t.title}`,
        message: `${t.projectCode}: "${t.title}" was due ${t.dueDate}. Update it or mark it blocked with a reason.`,
        projectId: t.projectId,
        dedupeKey: `task.overdue:${t.id}:${t.dueDate}`,
      });
    } else if (t.dueDate <= soonLimit) {
      alerts.push({
        recipientId: userId,
        type: "task.due_soon",
        title: `Due ${t.dueDate === today ? "today" : "soon"}: ${t.title}`,
        message: `${t.projectCode}: "${t.title}" is due ${t.dueDate}.`,
        projectId: t.projectId,
        dedupeKey: `task.due_soon:${t.id}:${t.dueDate}`,
      });
    }
  }
  for (const t of ownedOverdue) {
    if (t.assignedTo === userId || t.dueDate >= today) continue;
    alerts.push({
      recipientId: userId,
      type: "task.overdue_owner",
      title: `Overdue task in ${t.projectCode}`,
      message: `"${t.title}" was due ${t.dueDate} and is not done.`,
      projectId: t.projectId,
      dedupeKey: `task.overdue_owner:${t.id}:${t.dueDate}`,
    });
  }
  return alerts;
}

/** Days a project may wait in "pending approval" before its owner is reminded, then Admins too. */
export const APPROVAL_REMINDER_DAYS = { owner: 2, again: 7 } as const;

type PendingApproval = { projectId: string; code: string; ownerId: string; requestEventId: string; requestedAt: Date };

/**
 * Pure: approval reminders (roadmap Stage 2). The project owner is reminded after 2 days and again
 * after 7; Admins are told about anything waiting 7 days. Keys include the approval request, so a
 * new request starts the clock again.
 */
export function approvalReminders(userId: string, isAdmin: boolean, pending: PendingApproval[], now: Date): DeadlineAlert[] {
  const alerts: DeadlineAlert[] = [];
  for (const p of pending) {
    const days = Math.floor((now.getTime() - p.requestedAt.getTime()) / 86_400_000);
    const waiting = `${p.code} has been waiting for approval for ${days} days.`;
    if (p.ownerId === userId) {
      for (const step of [APPROVAL_REMINDER_DAYS.owner, APPROVAL_REMINDER_DAYS.again]) {
        if (days >= step) {
          alerts.push({
            recipientId: userId,
            type: "approval.waiting",
            title: `Approval waiting: ${p.code}`,
            message: `${waiting} Approve it or return it for changes.`,
            projectId: p.projectId,
            dedupeKey: `approval.waiting:${p.requestEventId}:${step}d`,
          });
        }
      }
    } else if (isAdmin && days >= APPROVAL_REMINDER_DAYS.again) {
      alerts.push({
        recipientId: userId,
        type: "approval.escalated",
        title: `Approval overdue: ${p.code}`,
        message: `${waiting} The project owner has been reminded.`,
        projectId: p.projectId,
        dedupeKey: `approval.escalated:${p.requestEventId}`,
      });
    }
  }
  return alerts;
}

const openTask = notInArray(tasks.status, ["DONE", "WAIVED"]);
const openProject = inArray(projects.status, ["PLANNING", "IN_PROGRESS", "CHANGES_REQUESTED"]);
const fields = {
  id: tasks.id,
  title: tasks.title,
  dueDate: sql<string>`${tasks.dueDate}`,
  assignedTo: tasks.assignedTo,
  projectCode: projects.code,
  projectId: projects.id,
};

/**
 * Creates any due-soon/overdue alerts the signed-in user is missing. Notifications are in-app
 * only, so generating them when the user opens the app is equivalent to a scheduled job, and
 * needs no scheduler. Safe to call on every page load: existing alerts are skipped.
 */
export async function refreshDeadlineAlerts(actor: Actor, now: Date = new Date()): Promise<number> {
  const today = todayInOperatingZone(now);
  return withActor(actor, async (tx) => {
    const assigned = await tx
      .select(fields)
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.assignedTo, actor.id), isNotNull(tasks.dueDate), lte(tasks.dueDate, addDays(today, DUE_SOON_DAYS)), openTask, openProject));
    const ownedOverdue =
      actor.role === "TEAM_MEMBER"
        ? []
        : await tx
            .select(fields)
            .from(tasks)
            .innerJoin(projects, eq(projects.id, tasks.projectId))
            .where(
              and(eq(projects.projectOwnerId, actor.id), isNotNull(tasks.dueDate), lte(tasks.dueDate, addDays(today, -1)), openTask, openProject),
            );
    const alerts = deadlineAlerts(actor.id, assigned as DeadlineTask[], ownedOverdue as DeadlineTask[], today);
    if (actor.role !== "TEAM_MEMBER") {
      const pending = await tx
        .select({ projectId: projects.id, code: projects.code, ownerId: projects.projectOwnerId })
        .from(projects)
        .where(eq(projects.status, "PENDING_APPROVAL"));
      const withRequests: PendingApproval[] = [];
      for (const p of pending) {
        if (p.ownerId !== actor.id && actor.role !== "ADMIN") continue;
        const [request] = await tx
          .select({ id: auditEvents.id, at: auditEvents.createdAt })
          .from(auditEvents)
          .where(and(eq(auditEvents.projectId, p.projectId), eq(auditEvents.action, "project.approval_requested")))
          .orderBy(desc(auditEvents.createdAt))
          .limit(1);
        if (request) withRequests.push({ ...p, requestEventId: request.id, requestedAt: request.at });
      }
      alerts.push(...approvalReminders(actor.id, actor.role === "ADMIN", withRequests, now));
    }
    if (alerts.length === 0) return 0;
    const inserted = await tx
      .insert(notifications)
      .values(
        alerts.map((a) => ({
          recipientId: a.recipientId,
          type: a.type,
          title: a.title,
          message: a.message,
          entityType: "project",
          entityId: a.projectId,
          dedupeKey: a.dedupeKey,
        })),
      )
      .onConflictDoNothing({ target: [notifications.recipientId, notifications.dedupeKey], where: sql`${notifications.dedupeKey} IS NOT NULL` })
      .returning({ id: notifications.id });
    return inserted.length;
  });
}

/** For page loads: alerts are a convenience, so a failure is logged and never blocks the page. */
export async function refreshDeadlineAlertsQuietly(actor: Actor): Promise<void> {
  try {
    await refreshDeadlineAlerts(actor);
  } catch (error) {
    console.error("Deadline alerts failed", error instanceof Error ? error.message : error);
  }
}
