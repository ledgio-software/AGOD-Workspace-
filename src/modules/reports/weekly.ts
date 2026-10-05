import { aliasedTable, and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import { adjustments, auditEvents, paymentTransactions, projects, tasks, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { type Actor, assertCan } from "@/lib/permissions";
import { addDays } from "@/modules/notifications/deadlines";
import { listProjects } from "@/modules/projects";
import { OPEN_TASK_STATUSES } from "@/modules/projects/rules";

// Weekly progress summary (roadmap Stage 2): what moved in one week (Monday to Sunday in the
// operating timezone), what is stuck now, and what is due next. Read-only; also as plain text
// for pasting into a chat.

/** Monday (YYYY-MM-DD) of the week containing the date. */
export function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

// Africa/Accra is UTC+0 all year, so the week's bounds in UTC are midnight to midnight.
const at = (date: string) => new Date(`${date}T00:00:00Z`);
const OPEN = ["PLANNING", "IN_PROGRESS", "CHANGES_REQUESTED", "PENDING_APPROVAL"] as const;
const APPROVAL_ACTIONS = ["project.approval_requested", "project.approved", "project.changes_requested", "project.reopened"];

export async function getWeeklySummary(actor: Actor, rawWeek?: string) {
  assertCan(actor, "report.weekly");
  const today = todayInOperatingZone();
  const start = weekStartOf(rawWeek && /^\d{4}-\d{2}-\d{2}$/.test(rawWeek) ? rawWeek : today);
  const end = addDays(start, 7);
  const assignee = aliasedTable(users, "assignee");

  const data = await withActor(actor, async (tx) => {
    const completed = await tx
      .select({ id: tasks.id, title: tasks.title, projectCode: projects.code, person: assignee.name, completedAt: tasks.completedAt })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(assignee, eq(assignee.id, tasks.assignedTo))
      .where(and(eq(tasks.status, "DONE"), gte(tasks.completedAt, at(start)), lt(tasks.completedAt, at(end))))
      .orderBy(asc(tasks.completedAt));

    const newlyBlocked = await tx
      .select({ taskId: auditEvents.entityId, title: tasks.title, projectCode: projects.code, reason: sql<string | null>`${auditEvents.afterJson}->>'blockedReason'` })
      .from(auditEvents)
      .innerJoin(tasks, eq(tasks.id, auditEvents.entityId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(auditEvents.action, "task.progress_updated"),
          sql`${auditEvents.afterJson}->>'status' = 'BLOCKED'`,
          gte(auditEvents.createdAt, at(start)),
          lt(auditEvents.createdAt, at(end)),
        ),
      );

    const openTasks = await tx
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, projectCode: projects.code, person: assignee.name, blockedReason: tasks.blockedReason })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(assignee, eq(assignee.id, tasks.assignedTo))
      .where(and(inArray(tasks.status, [...OPEN_TASK_STATUSES]), inArray(projects.status, [...OPEN])))
      .orderBy(asc(tasks.dueDate));

    const approvals = await tx
      .select({ action: auditEvents.action, at: auditEvents.createdAt, projectCode: projects.code, projectName: projects.name, reason: auditEvents.reason })
      .from(auditEvents)
      .innerJoin(projects, eq(projects.id, auditEvents.projectId))
      .where(and(inArray(auditEvents.action, APPROVAL_ACTIONS), gte(auditEvents.createdAt, at(start)), lt(auditEvents.createdAt, at(end))))
      .orderBy(asc(auditEvents.createdAt));

    const [paid] = await tx
      .select({ total: sql<number>`coalesce(sum(${paymentTransactions.amountMinor}), 0)::bigint`.mapWith(Number), count: sql<number>`count(*)::int` })
      .from(paymentTransactions)
      .where(and(gte(paymentTransactions.paidAt, at(start)), lt(paymentTransactions.paidAt, at(end))));
    const [adjusted] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(adjustments)
      .where(and(gte(adjustments.createdAt, at(start)), lt(adjustments.createdAt, at(end))));

    return { completed, newlyBlocked, openTasks, approvals, paid, adjustedCount: adjusted.count };
  });

  const atRisk = (await listProjects(actor)).filter((p) => p.health && p.health !== "ON_TRACK");
  const byPerson = new Map<string, number>();
  for (const t of data.completed) byPerson.set(t.person ?? "Unassigned", (byPerson.get(t.person ?? "Unassigned") ?? 0) + 1);
  const nextEnd = addDays(today, 7);

  return {
    start,
    end: addDays(end, -1),
    isCurrentWeek: start === weekStartOf(today),
    completed: data.completed,
    completedByPerson: [...byPerson.entries()].sort((a, b) => b[1] - a[1]),
    newlyBlocked: data.newlyBlocked,
    blockedNow: data.openTasks.filter((t) => t.status === "BLOCKED"),
    overdueNow: data.openTasks.filter((t) => t.dueDate !== null && t.dueDate < today),
    dueNext: data.openTasks.filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate < nextEnd),
    approvals: data.approvals,
    paidMinor: data.paid.total,
    paymentCount: data.paid.count,
    adjustmentCount: data.adjustedCount,
    atRisk,
  };
}

export type WeeklySummary = Awaited<ReturnType<typeof getWeeklySummary>>;

const approvalVerb: Record<string, string> = {
  "project.approval_requested": "approval requested",
  "project.approved": "approved",
  "project.changes_requested": "returned for changes",
  "project.reopened": "reopened",
};

/** The summary as plain text, for WhatsApp, Slack or email. */
export function summaryText(s: WeeklySummary): string {
  const lines = [`AGOD weekly summary, ${s.start} to ${s.end}`, ""];
  lines.push(`Completed: ${s.completed.length} task(s)${s.completedByPerson.length ? ` (${s.completedByPerson.map(([n, c]) => `${n} ${c}`).join(", ")})` : ""}`);
  lines.push(`Payments: ${formatMoney(s.paidMinor)} in ${s.paymentCount} payment(s); ${s.adjustmentCount} adjustment(s)`);
  if (s.approvals.length) {
    lines.push("", "Approvals:");
    for (const a of s.approvals) lines.push(`- ${a.projectCode} ${approvalVerb[a.action] ?? a.action}`);
  }
  if (s.blockedNow.length) {
    lines.push("", `Blocked now (${s.blockedNow.length}):`);
    for (const t of s.blockedNow) lines.push(`- ${t.projectCode} ${t.title}${t.person ? ` (${t.person})` : ""}: ${t.blockedReason ?? ""}`);
  }
  if (s.overdueNow.length) {
    lines.push("", `Overdue now (${s.overdueNow.length}):`);
    for (const t of s.overdueNow) lines.push(`- ${t.projectCode} ${t.title}${t.person ? ` (${t.person})` : ""}, due ${t.dueDate}`);
  }
  if (s.atRisk.length) {
    lines.push("", "Projects needing attention:");
    for (const p of s.atRisk) lines.push(`- ${p.code} ${p.name}: ${p.health?.replace("_", " ").toLowerCase()}`);
  }
  if (s.dueNext.length) {
    lines.push("", `Due in the next 7 days (${s.dueNext.length}):`);
    for (const t of s.dueNext) lines.push(`- ${t.dueDate} ${t.projectCode} ${t.title}${t.person ? ` (${t.person})` : ""}`);
  }
  return lines.join("\n");
}

