import { aliasedTable, and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { paymentTransactions, payoutLedgerEntries, projects, users } from "@/lib/db/schema";
import { type Actor, assertCan } from "@/lib/permissions";

export const ledgerFilters = z.object({
  memberId: z.uuid().optional().catch(undefined),
  projectId: z.uuid().optional().catch(undefined),
  status: z.enum(["OWED", "PARTIALLY_PAID", "PAID", "DISPUTED", "VOIDED"]).optional().catch(undefined),
});

export type LedgerRow = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  memberId: string;
  memberName: string;
  status: "OWED" | "PARTIALLY_PAID" | "PAID" | "DISPUTED" | "VOIDED";
  currency: string;
  owedMinor: number;
  paidMinor: number;
  approvedByName: string;
  approvedAt: Date;
  notes: string | null;
};

/** The payout ledger for PMs and Admins (members use My Work for their own entries). */
export async function listLedger(actor: Actor, raw: z.input<typeof ledgerFilters> = {}) {
  assertCan(actor, "payout.viewAll");
  const filters = ledgerFilters.parse(raw);
  return withActor(actor, async (tx) => {
    const approver = aliasedTable(users, "approver");
    const conditions = [];
    if (filters.memberId) conditions.push(eq(payoutLedgerEntries.memberId, filters.memberId));
    if (filters.projectId) conditions.push(eq(payoutLedgerEntries.projectId, filters.projectId));
    if (filters.status) conditions.push(eq(payoutLedgerEntries.status, filters.status));

    const rows = await tx
      .select({
        entry: payoutLedgerEntries,
        projectCode: projects.code,
        projectName: projects.name,
        memberName: users.name,
        approvedByName: approver.name,
      })
      .from(payoutLedgerEntries)
      .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
      .innerJoin(users, eq(users.id, payoutLedgerEntries.memberId))
      .innerJoin(approver, eq(approver.id, payoutLedgerEntries.approvedBy))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(payoutLedgerEntries.approvedAt));

    const paid = rows.length
      ? await tx
          .select({ ledgerEntryId: paymentTransactions.ledgerEntryId, total: sql<string>`sum(${paymentTransactions.amountMinor})` })
          .from(paymentTransactions)
          .where(inArray(paymentTransactions.ledgerEntryId, rows.map((r) => r.entry.id)))
          .groupBy(paymentTransactions.ledgerEntryId)
      : [];

    const result: LedgerRow[] = rows.map(({ entry, projectCode, projectName, memberName, approvedByName }) => ({
      id: entry.id,
      projectId: entry.projectId,
      projectCode,
      projectName,
      memberId: entry.memberId,
      memberName,
      status: entry.status,
      currency: entry.currency,
      owedMinor: entry.amountOwedMinor,
      paidMinor: Number(paid.find((p) => p.ledgerEntryId === entry.id)?.total ?? 0),
      approvedByName,
      approvedAt: entry.approvedAt,
      notes: entry.notes,
    }));

    const active = result.filter((r) => r.status !== "VOIDED");
    return {
      rows: result,
      totals: {
        owedMinor: active.reduce((s, r) => s + r.owedMinor, 0),
        paidMinor: active.reduce((s, r) => s + r.paidMinor, 0),
      },
    };
  });
}
