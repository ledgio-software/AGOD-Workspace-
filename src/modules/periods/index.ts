import { type AnyColumn, and, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { adjustments, payoutPeriods, payoutQuestions, paymentTransactions, payoutLedgerEntries, projects, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { ledgerRowsTx, ledgerTotals } from "@/modules/ledger";
import type { PeriodMovement } from "@/modules/reports/csv";

// Roadmap 2.9, period close: review a month, export it, then lock it. A closed month refuses
// payments dated in it and adjustments made while it is closed (database triggers); reopening
// is Admin-only and needs a reason. Months are calendar months in the operating timezone.

export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month (YYYY-MM)");

export function currentPeriod(now: Date = new Date()): string {
  return todayInOperatingZone(now).slice(0, 7);
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Last calendar day of the month, YYYY-MM-DD. */
export function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Matches timestamps in the month, using the same database function as the lock triggers. */
const inPeriod = (column: AnyColumn, period: string) => sql`app_period_of(${column}) = ${period}`;

/** Everything the close checklist shows for one month. */
export async function getPeriodClose(actor: Actor, rawPeriod: string) {
  assertCan(actor, "period.view");
  const period = periodSchema.parse(rawPeriod);
  return withActor(actor, async (tx) => {
    const [state] = await tx.select().from(payoutPeriods).where(eq(payoutPeriods.period, period));

    // 1. Projects approved in the month (payouts created).
    const approved = await tx
      .select({
        projectId: projects.id,
        code: projects.code,
        name: projects.name,
        approvedAt: sql<Date>`min(${payoutLedgerEntries.approvedAt})`,
        owedMinor: sql<number>`sum(${payoutLedgerEntries.amountOwedMinor})::bigint`.mapWith(Number),
      })
      .from(payoutLedgerEntries)
      .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
      .where(inPeriod(payoutLedgerEntries.approvedAt, period))
      .groupBy(projects.id, projects.code, projects.name)
      .orderBy(projects.code);

    // 2. Outstanding balances today, for payouts approved by the end of the month.
    const ledger = await ledgerRowsTx(tx, { to: periodEnd(period) });
    const outstanding = ledger.filter((r) => r.status !== "VOIDED" && r.remainingMinor > 0);

    // 3. Payments dated in the month.
    const payments = await tx
      .select({ payment: paymentTransactions, projectCode: projects.code, memberName: users.name })
      .from(paymentTransactions)
      .innerJoin(payoutLedgerEntries, eq(payoutLedgerEntries.id, paymentTransactions.ledgerEntryId))
      .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
      .innerJoin(users, eq(users.id, payoutLedgerEntries.memberId))
      .where(inPeriod(paymentTransactions.paidAt, period))
      .orderBy(paymentTransactions.paidAt);

    // 4. Adjustments made in the month.
    const adjustmentRows = await tx
      .select({ adjustment: adjustments, projectCode: projects.code, memberName: users.name, currency: payoutLedgerEntries.currency })
      .from(adjustments)
      .innerJoin(payoutLedgerEntries, eq(payoutLedgerEntries.id, adjustments.ledgerEntryId))
      .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
      .innerJoin(users, eq(users.id, payoutLedgerEntries.memberId))
      .where(inPeriod(adjustments.createdAt, period))
      .orderBy(adjustments.createdAt);

    // Unresolved payout questions raised by the end of the month: settle these before closing.
    const openQuestions = await tx
      .select({ id: payoutQuestions.id, ledgerEntryId: payoutQuestions.ledgerEntryId, question: payoutQuestions.question, projectCode: projects.code })
      .from(payoutQuestions)
      .innerJoin(projects, eq(projects.id, payoutQuestions.projectId))
      .where(and(ne(payoutQuestions.status, "RESOLVED"), lte(sql`app_period_of(${payoutQuestions.createdAt})`, period)));

    const history = await tx
      .select({ period: payoutPeriods.period, locked: payoutPeriods.locked, lockedAt: payoutPeriods.lockedAt })
      .from(payoutPeriods)
      .orderBy(desc(payoutPeriods.period))
      .limit(12);

    const nameIds = [state?.lockedBy, state?.unlockedBy].filter((id): id is string => !!id);
    const names = new Map(
      nameIds.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, nameIds))).map((u) => [u.id, u.name]) : [],
    );

    return {
      period,
      closable: period < currentPeriod(),
      state: state
        ? {
            ...state,
            lockedByName: state.lockedBy ? (names.get(state.lockedBy) ?? null) : null,
            unlockedByName: state.unlockedBy ? (names.get(state.unlockedBy) ?? null) : null,
          }
        : null,
      approved,
      outstanding,
      outstandingTotals: ledgerTotals(outstanding),
      payments: payments.map((p) => ({ ...p.payment, projectCode: p.projectCode, memberName: p.memberName })),
      paymentsTotalMinor: payments.reduce((s, p) => s + p.payment.amountMinor, 0),
      adjustments: adjustmentRows.map((a) => ({ ...a.adjustment, projectCode: a.projectCode, memberName: a.memberName, currency: a.currency })),
      openQuestions,
      history,
    };
  });
}

const noteInput = z.string().trim().max(1000);

export async function closePeriod(actor: Actor, rawPeriod: string, rawNote: string, request?: RequestMeta) {
  assertCan(actor, "period.close");
  const period = periodSchema.parse(rawPeriod);
  const note = noteInput.parse(rawNote) || null;
  if (period >= currentPeriod()) throw new ServiceError("Only a finished month can be closed.");
  await withActor(actor, async (tx) => {
    const [existing] = await tx.select().from(payoutPeriods).where(eq(payoutPeriods.period, period)).for("update");
    if (existing?.locked) throw new ServiceError(`${period} is already closed.`);
    const values = { locked: true, lockedBy: actor.id, lockedAt: new Date(), lockNote: note };
    const [row] = existing
      ? await tx.update(payoutPeriods).set(values).where(eq(payoutPeriods.id, existing.id)).returning().catch(rethrowDbGuard)
      : await tx.insert(payoutPeriods).values({ period, ...values }).returning().catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "period",
      entityId: row.id,
      action: "period.closed",
      before: { period, locked: existing?.locked ?? false },
      after: { period, locked: true },
      reason: note,
      request,
    });
  });
}

export async function reopenPeriod(actor: Actor, rawPeriod: string, rawReason: string, request?: RequestMeta) {
  assertCan(actor, "period.close");
  const period = periodSchema.parse(rawPeriod);
  const reason = z.string().trim().min(3, "Give a reason for reopening (at least 3 characters)").max(1000).parse(rawReason);
  await withActor(actor, async (tx) => {
    const [existing] = await tx.select().from(payoutPeriods).where(eq(payoutPeriods.period, period)).for("update");
    if (!existing?.locked) throw new ServiceError(`${period} is not closed.`);
    await tx
      .update(payoutPeriods)
      .set({ locked: false, unlockedBy: actor.id, unlockedAt: new Date(), unlockReason: reason })
      .where(eq(payoutPeriods.id, existing.id))
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "period",
      entityId: existing.id,
      action: "period.reopened",
      before: { period, locked: true },
      after: { period, locked: false },
      reason,
      request,
    });
  });
}

/** Payments and adjustments of a month as signed movements, for the close export. */
export function periodMovements(close: Awaited<ReturnType<typeof getPeriodClose>>): PeriodMovement[] {
  const sign = { INCREASE: 1, DECREASE: -1, WRITE_OFF: -1, VOID: 0 } as const;
  return [
    ...close.payments.map((p) => ({
      date: p.paidAt,
      kind: "PAYMENT" as const,
      projectCode: p.projectCode,
      memberName: p.memberName,
      currency: p.currency,
      amountMinor: p.amountMinor,
      method: p.method,
      reference: p.reference,
      note: p.notes,
    })),
    ...close.adjustments.map((a) => ({
      date: a.createdAt,
      kind: a.type,
      projectCode: a.projectCode,
      memberName: a.memberName,
      currency: a.currency,
      amountMinor: sign[a.type] * a.amountMinor,
      method: null,
      reference: null,
      note: a.reason,
    })),
  ];
}
