import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { adjustments, auditEvents, payoutLedgerEntries, paymentTransactions, projects, tasks, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Actor, assertCan } from "@/lib/permissions";
import { ledgerRowsTx, ledgerTotals } from "@/modules/ledger";
import { isTaskOverdue } from "@/modules/projects/rules";

export const periodInput = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

/** Current calendar month in the operating timezone. */
export function defaultPeriod(today = todayInOperatingZone()) {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

function sumBy<T>(items: T[], key: (t: T) => string, value: (t: T) => number) {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + value(item));
  return map;
}

/** Manager dashboard and reports (design doc sections 8 and 10). */
export async function getDashboard(actor: Actor, raw: z.input<typeof periodInput> = {}) {
  assertCan(actor, "payout.viewAll");
  const input = periodInput.parse(raw);
  const period = { ...defaultPeriod(), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v)) } as {
    from: string;
    to: string;
  };

  return withActor(actor, async (tx) => {
    const today = todayInOperatingZone();
    const rows = await ledgerRowsTx(tx);
    const totals = ledgerTotals(rows);
    const active = rows.filter((r) => r.status !== "VOIDED");

    const paidInPeriod = await tx
      .select({ amountMinor: paymentTransactions.amountMinor })
      .from(paymentTransactions)
      .innerJoin(payoutLedgerEntries, eq(payoutLedgerEntries.id, paymentTransactions.ledgerEntryId))
      .where(
        and(
          gte(paymentTransactions.paidAt, new Date(`${period.from}T00:00:00Z`)),
          lte(paymentTransactions.paidAt, new Date(`${period.to}T23:59:59.999Z`)),
        ),
      );

    const outstandingByMember = [...sumBy(active, (r) => r.memberName, (r) => r.remainingMinor)]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, remainingMinor]) => ({ name, remainingMinor }));

    const byProject = new Map<string, { id: string; code: string; name: string; owedMinor: number; remainingMinor: number }>();
    for (const r of active) {
      const p = byProject.get(r.projectId) ?? { id: r.projectId, code: r.projectCode, name: r.projectName, owedMinor: 0, remainingMinor: 0 };
      p.owedMinor += r.effectiveOwedMinor;
      p.remainingMinor += r.remainingMinor;
      byProject.set(r.projectId, p);
    }
    const projectsOwed = [...byProject.values()].sort((a, b) => b.remainingMinor - a.remainingMinor);

    const projectRows = await tx.select().from(projects);
    const awaitingApproval = projectRows.filter((p) => p.status === "PENDING_APPROVAL");
    const openProjects = projectRows.filter((p) => !["COMPLETED", "CANCELLED", "DRAFT"].includes(p.status));
    const overdueProjects = openProjects.filter((p) => p.targetDate !== null && p.targetDate < today);

    const openTaskRows = openProjects.length
      ? await tx
          .select({ task: tasks, projectCode: projects.code, assigneeName: users.name })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .leftJoin(users, eq(users.id, tasks.assignedTo))
          .where(inArray(tasks.projectId, openProjects.map((p) => p.id)))
      : [];
    const overdueTasks = openTaskRows.filter((t) => isTaskOverdue(t.task, today));

    const recentAdjustments = await tx
      .select({ adjustment: adjustments, memberName: users.name, projectCode: projects.code })
      .from(adjustments)
      .innerJoin(payoutLedgerEntries, eq(payoutLedgerEntries.id, adjustments.ledgerEntryId))
      .innerJoin(users, eq(users.id, payoutLedgerEntries.memberId))
      .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
      .orderBy(desc(adjustments.createdAt))
      .limit(10);

    const recentActivity = await tx
      .select({ event: auditEvents, actorName: users.name, projectCode: projects.code })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .leftJoin(projects, eq(projects.id, auditEvents.projectId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(15);

    return {
      today,
      period,
      totals,
      paidInPeriodMinor: paidInPeriod.reduce((s, p) => s + p.amountMinor, 0),
      outstandingByMember,
      projectsOwed,
      completedNotFullyPaid: projectsOwed.filter((p) => p.remainingMinor > 0),
      partialPayments: active.filter((r) => r.status === "PARTIALLY_PAID"),
      clientTypeTotals: {
        INTERNAL: active.filter((r) => r.clientType === "INTERNAL").reduce((s, r) => s + r.effectiveOwedMinor, 0),
        EXTERNAL: active.filter((r) => r.clientType === "EXTERNAL").reduce((s, r) => s + r.effectiveOwedMinor, 0),
      },
      awaitingApproval: awaitingApproval.map((p) => ({ id: p.id, code: p.code, name: p.name })),
      overdueProjects: overdueProjects.map((p) => ({ id: p.id, code: p.code, name: p.name, targetDate: p.targetDate })),
      overdueTasks: overdueTasks.map((t) => ({
        id: t.task.id,
        projectId: t.task.projectId,
        projectCode: t.projectCode,
        title: t.task.title,
        dueDate: t.task.dueDate,
        assigneeName: t.assigneeName,
      })),
      recentAdjustments: recentAdjustments.map((a) => ({ ...a.adjustment, memberName: a.memberName, projectCode: a.projectCode })),
      recentActivity: recentActivity.map((a) => ({ ...a.event, actorName: a.actorName, projectCode: a.projectCode })),
    };
  });
}
