import { aliasedTable, and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { compensationSnapshotLines, paymentTransactions, payoutLedgerEntries, projects, users } from "@/lib/db/schema";
import { type Actor, assertCan } from "@/lib/permissions";
import { balancesFor } from "@/modules/payments";
import type { PayoutStatus } from "@/modules/payments/balance";

const optionalDate = z.iso.date().optional().catch(undefined);

export const ledgerFilters = z.object({
  memberId: z.uuid().optional().catch(undefined),
  projectId: z.uuid().optional().catch(undefined),
  status: z.enum(["OWED", "PARTIALLY_PAID", "PAID", "DISPUTED", "VOIDED"]).optional().catch(undefined),
  /** Approval date range (inclusive), YYYY-MM-DD. */
  from: optionalDate,
  to: optionalDate,
});

export type LedgerRow = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientType: "INTERNAL" | "EXTERNAL";
  clientName: string | null;
  completedAt: Date | null;
  memberId: string;
  memberName: string;
  memberEmail: string;
  roleOnProject: string;
  status: PayoutStatus;
  currency: string;
  originalMinor: number;
  adjustmentsMinor: number;
  effectiveOwedMinor: number;
  paidMinor: number;
  remainingMinor: number;
  payments: { amountMinor: number; paidAt: Date; method: string; reference: string | null }[];
  approvedByName: string;
  approvedAt: Date;
  notes: string | null;
};

export type LedgerTotals = { owedMinor: number; paidMinor: number; remainingMinor: number; adjustmentsMinor: number };

/** Totals exclude voided entries. Shared by the ledger page, the dashboard and the CSV export. */
export function ledgerTotals(rows: LedgerRow[]): LedgerTotals {
  const active = rows.filter((r) => r.status !== "VOIDED");
  return {
    owedMinor: active.reduce((s, r) => s + r.effectiveOwedMinor, 0),
    paidMinor: active.reduce((s, r) => s + r.paidMinor, 0),
    remainingMinor: active.reduce((s, r) => s + r.remainingMinor, 0),
    adjustmentsMinor: active.reduce((s, r) => s + r.adjustmentsMinor, 0),
  };
}

export async function ledgerRowsTx(tx: Tx, raw: z.input<typeof ledgerFilters> = {}): Promise<LedgerRow[]> {
  const filters = ledgerFilters.parse(raw);
  const approver = aliasedTable(users, "approver");
  const conditions = [];
  if (filters.memberId) conditions.push(eq(payoutLedgerEntries.memberId, filters.memberId));
  if (filters.projectId) conditions.push(eq(payoutLedgerEntries.projectId, filters.projectId));
  if (filters.status) conditions.push(eq(payoutLedgerEntries.status, filters.status));
  if (filters.from) conditions.push(gte(payoutLedgerEntries.approvedAt, new Date(`${filters.from}T00:00:00Z`)));
  if (filters.to) conditions.push(lte(payoutLedgerEntries.approvedAt, new Date(`${filters.to}T23:59:59.999Z`)));

  const rows = await tx
    .select({
      entry: payoutLedgerEntries,
      project: projects,
      memberName: users.name,
      memberEmail: users.email,
      approvedByName: approver.name,
      roleOnProject: compensationSnapshotLines.roleOnProject,
    })
    .from(payoutLedgerEntries)
    .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
    .innerJoin(users, eq(users.id, payoutLedgerEntries.memberId))
    .innerJoin(approver, eq(approver.id, payoutLedgerEntries.approvedBy))
    .innerJoin(compensationSnapshotLines, eq(compensationSnapshotLines.id, payoutLedgerEntries.snapshotLineId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(payoutLedgerEntries.approvedAt));

  const balances = await balancesFor(tx, rows.map((r) => r.entry));
  const payments = rows.length
    ? await tx
        .select()
        .from(paymentTransactions)
        .where(inArray(paymentTransactions.ledgerEntryId, rows.map((r) => r.entry.id)))
    : [];

  return rows.map(({ entry, project, memberName, memberEmail, approvedByName, roleOnProject }) => {
    const b = balances.get(entry.id)!;
    return {
      id: entry.id,
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      clientType: project.clientType,
      clientName: project.clientName,
      completedAt: project.completedAt,
      memberId: entry.memberId,
      memberName,
      memberEmail,
      roleOnProject,
      status: entry.status,
      currency: entry.currency,
      originalMinor: b.originalMinor,
      adjustmentsMinor: b.adjustmentsMinor,
      effectiveOwedMinor: entry.status === "VOIDED" ? 0 : b.effectiveOwedMinor,
      paidMinor: b.paidMinor,
      remainingMinor: b.remainingMinor,
      payments: payments
        .filter((p) => p.ledgerEntryId === entry.id)
        .map((p) => ({ amountMinor: p.amountMinor, paidAt: p.paidAt, method: p.method, reference: p.reference })),
      approvedByName,
      approvedAt: entry.approvedAt,
      notes: entry.notes,
    };
  });
}

/** The payout ledger for PMs and Admins (members use My Work for their own entries). */
export async function listLedger(actor: Actor, raw: z.input<typeof ledgerFilters> = {}) {
  assertCan(actor, "payout.viewAll");
  return withActor(actor, async (tx) => {
    const rows = await ledgerRowsTx(tx, raw);
    return { rows, totals: ledgerTotals(rows) };
  });
}
