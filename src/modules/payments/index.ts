import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { adjustments, organizations, paymentTransactions, payoutLedgerEntries, projects, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { formatMoney, parseMoney } from "@/lib/money";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError } from "@/modules/errors";
import { notify } from "@/modules/notifications";
import { type Balance, payoutBalance } from "./balance";

const money = (label: string) =>
  z.string().transform((v, ctx) => {
    const minor = parseMoney(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: `Enter the ${label} in GHS, e.g. 500.00` });
      return z.NEVER;
    }
    return minor;
  });
const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .nullish();

export const paymentInput = z.object({
  amount: money("amount").refine((v) => v > 0, "The amount must be more than zero."),
  method: z.enum(["MOBILE_MONEY", "BANK_TRANSFER", "CASH", "OTHER"]),
  reference: optionalText,
  paidOn: z.iso.date("Enter the payment date"),
  // File uploads need a storage provider (not chosen yet); a link to the receipt works today.
  evidenceUrl: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.url({ protocol: /^https?$/, message: "Evidence must be an http(s) link" }).nullable())
    .nullish(),
  notes: optionalText,
});

export const adjustmentInput = z
  .object({
    type: z.enum(["INCREASE", "DECREASE", "WRITE_OFF", "VOID"]),
    amount: z.string().optional(),
    reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(1000),
  })
  .transform((v, ctx) => {
    if (v.type === "VOID") return { type: v.type, amountMinor: 0, reason: v.reason };
    const minor = parseMoney(v.amount ?? "");
    if (minor === null || minor <= 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in GHS greater than zero." });
      return z.NEVER;
    }
    return { type: v.type, amountMinor: minor, reason: v.reason };
  });

/** Guard functions in the database raise check_violation with a safe message. */
function rethrowGuard(error: unknown): never {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "23514" || cause?.code === "42501") throw new ServiceError(cause.message ?? "Not allowed.");
  throw error;
}

/** Phase 29: how much of a payout may be paid so far (see app_payout_releasable). */
async function releasableOf(tx: Tx, entryId: string): Promise<number> {
  return Number((await tx.execute<{ r: string }>(sql`select app_payout_releasable(${entryId}) as r`)).rows[0].r);
}

/** Phase 28, two people for money (the database refuses it too). */
async function assertNotOwnPayout(tx: Tx, actor: Actor, payeeId: string) {
  if (payeeId !== actor.id) return;
  const [org] = await tx.select({ allow: organizations.allowSelfApproval }).from(organizations).where(eq(organizations.id, actor.orgId));
  if (!org?.allow) {
    throw new ServiceError("This is your own payout, so someone else must record it. A company with only one Admin can allow this on the Company page.");
  }
}

async function loadEntry(tx: Tx, entryId: string) {
  const [row] = await tx
    .select({ entry: payoutLedgerEntries, projectCode: projects.code, projectName: projects.name })
    .from(payoutLedgerEntries)
    .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
    .where(eq(payoutLedgerEntries.id, entryId));
  if (!row) throw new ServiceError("Payout not found.");
  return row;
}

async function balanceOf(tx: Tx, entry: typeof payoutLedgerEntries.$inferSelect): Promise<Balance> {
  const [adj, pay] = await Promise.all([
    tx.select().from(adjustments).where(eq(adjustments.ledgerEntryId, entry.id)),
    tx.select().from(paymentTransactions).where(eq(paymentTransactions.ledgerEntryId, entry.id)),
  ]);
  return payoutBalance({
    amountOwedMinor: entry.amountOwedMinor,
    voided: entry.status === "VOIDED",
    adjustments: adj,
    payments: pay,
  });
}

/** Decision 4: only Admins record payments. Full or partial; never above the outstanding balance. */
export async function recordPayment(
  actor: Actor,
  entryId: string,
  raw: z.input<typeof paymentInput>,
  request?: RequestMeta,
) {
  assertCan(actor, "payment.record");
  const input = paymentInput.parse(raw);
  if (input.paidOn > todayInOperatingZone()) throw new ServiceError("The payment date cannot be in the future.");
  return withActor(actor, async (tx) => {
    const { entry, projectCode, projectName } = await loadEntry(tx, entryId);
    await assertNotOwnPayout(tx, actor, entry.memberId);
    // Phase 29: when the company pays the team in step with the client (the database refuses it too).
    const before = await balanceOf(tx, entry);
    const releasable = await releasableOf(tx, entryId);
    if (releasable < before.effectiveOwedMinor && before.paidMinor + input.amount > releasable) {
      throw new ServiceError(
        `Only ${formatMoney(Math.max(releasable - before.paidMinor, 0), entry.currency)} of this payout can be paid now: the team is paid in step with what the client has paid for ${projectCode}.`,
      );
    }
    let payment;
    try {
      [payment] = await tx
        .insert(paymentTransactions)
        .values({
          ledgerEntryId: entryId,
          amountMinor: input.amount,
          currency: entry.currency,
          method: input.method,
          reference: input.reference ?? null,
          paidAt: new Date(`${input.paidOn}T12:00:00Z`),
          recordedBy: actor.id,
          evidenceFilePath: input.evidenceUrl ?? null,
          notes: input.notes ?? null,
        })
        .returning();
    } catch (error) {
      rethrowGuard(error);
    }
    const [updated] = await tx.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.id, entryId));
    const balance = await balanceOf(tx, updated);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "payment",
      entityId: payment.id,
      projectId: entry.projectId,
      action: "payment.recorded",
      after: {
        ledgerEntryId: entryId,
        memberId: entry.memberId,
        amountMinor: payment.amountMinor,
        method: payment.method,
        reference: payment.reference,
        paidAt: payment.paidAt,
        status: updated.status,
        remainingMinor: balance.remainingMinor,
      },
      request,
    });
    await notify(tx, actor, {
      recipientId: entry.memberId,
      type: "payment.recorded",
      title: `Payment recorded for ${projectCode}`,
      message: `${formatMoney(payment.amountMinor, payment.currency)} paid for "${projectName}". Remaining: ${formatMoney(balance.remainingMinor, entry.currency)}.`,
      entityType: "project",
      entityId: entry.projectId,
    });
    return { payment, balance };
  });
}

/** Admin-only corrections. The original amount never changes; the adjustment trail explains it. */
export async function createAdjustment(
  actor: Actor,
  entryId: string,
  raw: z.input<typeof adjustmentInput>,
  request?: RequestMeta,
) {
  assertCan(actor, "adjustment.create");
  const input = adjustmentInput.parse(raw);
  return withActor(actor, (tx) => createAdjustmentTx(tx, actor, entryId, input, request));
}

/** The adjustment itself, in the caller's transaction (also used when settling a payout question). */
export async function createAdjustmentTx(
  tx: Tx,
  actor: Actor,
  entryId: string,
  input: z.output<typeof adjustmentInput>,
  request?: RequestMeta,
) {
  assertCan(actor, "adjustment.create");
  const { entry, projectCode } = await loadEntry(tx, entryId);
  await assertNotOwnPayout(tx, actor, entry.memberId);
  let adjustment;
  try {
    [adjustment] = await tx
      .insert(adjustments)
      .values({
        ledgerEntryId: entryId,
        type: input.type,
        amountMinor: input.amountMinor,
        reason: input.reason,
        createdBy: actor.id,
        approvedBy: actor.id,
      })
      .returning();
  } catch (error) {
    rethrowGuard(error);
  }
  const [updated] = await tx.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.id, entryId));
  const balance = await balanceOf(tx, updated);
  await recordAudit(tx, {
    actorId: actor.id,
    entityType: "adjustment",
    entityId: adjustment.id,
    projectId: entry.projectId,
    action: "adjustment.created",
    before: { status: entry.status },
    after: {
      ledgerEntryId: entryId,
      type: adjustment.type,
      amountMinor: adjustment.amountMinor,
      status: updated.status,
      effectiveOwedMinor: balance.effectiveOwedMinor,
      remainingMinor: balance.remainingMinor,
    },
    reason: input.reason,
    request,
  });
  await notify(tx, actor, {
    recipientId: entry.memberId,
    type: "adjustment.created",
    title: `Payout adjusted for ${projectCode}`,
    message: `${input.type.replace("_", " ").toLowerCase()}${input.amountMinor ? ` of ${formatMoney(input.amountMinor, entry.currency)}` : ""}: ${input.reason}`,
    entityType: "project",
    entityId: entry.projectId,
  });
  return { adjustment, balance };
}

/** One payout with its payments and adjustments. Members can open only their own (row-level security). */
export async function getPayout(actor: Actor, entryId: string) {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ entry: payoutLedgerEntries, projectCode: projects.code, projectName: projects.name, memberName: users.name })
      .from(payoutLedgerEntries)
      .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
      .innerJoin(users, eq(users.id, payoutLedgerEntries.memberId))
      .where(eq(payoutLedgerEntries.id, entryId));
    if (!row) return null;
    const payments = await tx
      .select({ payment: paymentTransactions, recordedByName: users.name })
      .from(paymentTransactions)
      .innerJoin(users, eq(users.id, paymentTransactions.recordedBy))
      .where(eq(paymentTransactions.ledgerEntryId, entryId))
      .orderBy(asc(paymentTransactions.paidAt));
    const adjustmentRows = await tx
      .select({ adjustment: adjustments, createdByName: users.name })
      .from(adjustments)
      .innerJoin(users, eq(users.id, adjustments.createdBy))
      .where(eq(adjustments.ledgerEntryId, entryId))
      .orderBy(asc(adjustments.createdAt));
    const balance = payoutBalance({
      amountOwedMinor: row.entry.amountOwedMinor,
      voided: row.entry.status === "VOIDED",
      adjustments: adjustmentRows.map((a) => a.adjustment),
      payments: payments.map((p) => p.payment),
    });
    return {
      ...row,
      balance,
      /** Phase 29: what may be paid so far in total (less than owed while the client hasn't paid enough). */
      releasableMinor: await releasableOf(tx, entryId),
      payments: payments.map((p) => ({ ...p.payment, recordedByName: p.recordedByName })),
      adjustments: adjustmentRows.map((a) => ({ ...a.adjustment, createdByName: a.createdByName })),
    };
  });
}

/** Balances for many entries at once (ledger, My Work, dashboard, export). */
export async function balancesFor(tx: Tx, entries: (typeof payoutLedgerEntries.$inferSelect)[]) {
  if (entries.length === 0) return new Map<string, Balance>();
  const ids = entries.map((e) => e.id);
  const [adj, pay] = await Promise.all([
    tx.select().from(adjustments).where(inArray(adjustments.ledgerEntryId, ids)),
    tx.select().from(paymentTransactions).where(inArray(paymentTransactions.ledgerEntryId, ids)),
  ]);
  return new Map(
    entries.map((e) => [
      e.id,
      payoutBalance({
        amountOwedMinor: e.amountOwedMinor,
        voided: e.status === "VOIDED",
        adjustments: adj.filter((a) => a.ledgerEntryId === e.id),
        payments: pay.filter((p) => p.ledgerEntryId === e.id),
      }),
    ]),
  );
}
