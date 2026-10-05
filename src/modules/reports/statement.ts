import { and, asc, eq, inArray, like } from "drizzle-orm";
import { withActor } from "@/lib/db/actor";
import {
  adjustments,
  auditEvents,
  compensationSnapshotLines,
  compensationSnapshots,
  paymentTransactions,
  payoutLedgerEntries,
  projects,
  users,
} from "@/lib/db/schema";
import type { Actor } from "@/lib/permissions";
import { payoutBalance } from "@/modules/payments/balance";

export type StatementCheck = { label: string; ok: boolean; detail: string };

/**
 * Everything needed to explain a project's money (Phase 5 exit condition): value → approved
 * split per snapshot → adjustments with reasons → payments with references → remaining, plus
 * arithmetic checks and the status timeline. Members see only their own lines (row-level security).
 */
export async function getProjectStatement(actor: Actor, projectId: string) {
  return withActor(actor, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return null;

    const snapshots = await tx
      .select({ snapshot: compensationSnapshots, approverName: users.name })
      .from(compensationSnapshots)
      .innerJoin(users, eq(users.id, compensationSnapshots.createdBy))
      .where(eq(compensationSnapshots.projectId, projectId))
      .orderBy(asc(compensationSnapshots.sequence));
    const snapshotIds = snapshots.map((s) => s.snapshot.id);

    const lines = snapshotIds.length
      ? await tx
          .select({ line: compensationSnapshotLines, memberName: users.name, entry: payoutLedgerEntries })
          .from(compensationSnapshotLines)
          .innerJoin(users, eq(users.id, compensationSnapshotLines.memberId))
          .leftJoin(payoutLedgerEntries, eq(payoutLedgerEntries.snapshotLineId, compensationSnapshotLines.id))
          .where(inArray(compensationSnapshotLines.snapshotId, snapshotIds))
          .orderBy(asc(compensationSnapshotLines.createdAt))
      : [];
    const entryIds = lines.flatMap((l) => (l.entry ? [l.entry.id] : []));
    const [payments, adjustmentRows] = entryIds.length
      ? await Promise.all([
          tx.select().from(paymentTransactions).where(inArray(paymentTransactions.ledgerEntryId, entryIds)).orderBy(asc(paymentTransactions.paidAt)),
          tx.select().from(adjustments).where(inArray(adjustments.ledgerEntryId, entryIds)).orderBy(asc(adjustments.createdAt)),
        ])
      : [[], []];

    const checks: StatementCheck[] = [];
    const statementSnapshots = snapshots.map(({ snapshot, approverName }) => {
      const own = lines.filter((l) => l.line.snapshotId === snapshot.id);
      const recipients = own.map(({ line, memberName, entry }) => {
        const entryPayments = entry ? payments.filter((p) => p.ledgerEntryId === entry.id) : [];
        const entryAdjustments = entry ? adjustmentRows.filter((a) => a.ledgerEntryId === entry.id) : [];
        const balance = entry
          ? payoutBalance({ amountOwedMinor: entry.amountOwedMinor, voided: entry.status === "VOIDED", adjustments: entryAdjustments, payments: entryPayments })
          : null;
        if (entry) {
          checks.push({
            label: `Snapshot ${snapshot.sequence}, ${memberName}: ledger matches the approved line`,
            ok: entry.amountOwedMinor === line.amountOwedMinor,
            detail: `${entry.amountOwedMinor} vs ${line.amountOwedMinor} pesewas`,
          });
          if (balance) {
            checks.push({
              label: `Snapshot ${snapshot.sequence}, ${memberName}: stored status matches payments and adjustments`,
              ok: balance.status === entry.status,
              detail: `stored ${entry.status}, derived ${balance.status}`,
            });
          }
        }
        return { line, memberName, entry, payments: entryPayments, adjustments: entryAdjustments, balance };
      });
      const allocated = own.reduce((s, l) => s + l.line.amountOwedMinor, 0);
      return { snapshot, approverName, recipients, allocatedMinor: allocated };
    });

    // The value check needs every line, so only managers (who see all lines) get it.
    const seesAllLines = lines.length === 0 || actor.role !== "TEAM_MEMBER";
    if (seesAllLines) {
      for (const s of statementSnapshots) {
        // Percentage mode: team lines plus the AGOD share (0 before calculation version 2) make up the value.
        const pct = s.snapshot.splitMode === "PERCENTAGE";
        const ok = pct
          ? s.allocatedMinor + s.snapshot.agodShareMinor === s.snapshot.projectTotalValueMinor
          : s.allocatedMinor <= s.snapshot.projectTotalValueMinor;
        checks.push({
          label: `Snapshot ${s.snapshot.sequence}: allocations ${pct ? (s.snapshot.agodShareMinor > 0 ? "plus the AGOD share equal" : "equal") : "do not exceed"} the project value`,
          ok,
          detail: `${s.allocatedMinor}${pct && s.snapshot.agodShareMinor > 0 ? ` + ${s.snapshot.agodShareMinor}` : ""} of ${s.snapshot.projectTotalValueMinor} pesewas`,
        });
      }
    }

    const timeline = await tx
      .select({ event: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(and(eq(auditEvents.projectId, projectId), like(auditEvents.action, "project.%")))
      .orderBy(asc(auditEvents.createdAt));

    return {
      project,
      snapshots: statementSnapshots,
      checks,
      timeline: timeline.map((t) => ({ ...t.event, actorName: t.actorName })),
    };
  });
}
