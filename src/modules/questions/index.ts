import { type SQL, aliasedTable, and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { payoutLedgerEntries, payoutQuestions, projects, users } from "@/lib/db/schema";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { notify } from "@/modules/notifications";
import { adjustmentInput, createAdjustmentTx } from "@/modules/payments";

// Roadmap 2.8: a member questions a payout without touching the ledger. A PM reviews it (no change,
// or "needs an adjustment"); only an Admin records an adjustment, which is linked to the question.
// The original amount always stays visible; corrections are separate adjustment events.

const text = (min: number, label: string) => z.string().trim().min(min, `${label} (at least ${min} characters)`).max(2000);

export const questionInput = z.object({ question: text(10, "Describe your question") });
export const reviewInput = z.object({
  outcome: z.enum(["NO_CHANGE", "NEEDS_ADJUSTMENT"]),
  note: text(3, "Explain the outcome"),
});
export const resolveInput = z.object({
  resolution: text(3, "Explain the resolution"),
  /** When set, the Admin records this adjustment as part of resolving the question. */
  adjustment: z.unknown().optional(),
});

export type PayoutQuestion = typeof payoutQuestions.$inferSelect;

async function loadQuestion(tx: Tx, questionId: string) {
  const [row] = await tx
    .select({ question: payoutQuestions, projectCode: projects.code })
    .from(payoutQuestions)
    .innerJoin(projects, eq(projects.id, payoutQuestions.projectId))
    .where(eq(payoutQuestions.id, questionId))
    .for("update", { of: payoutQuestions });
  if (!row) throw new ServiceError("Question not found.");
  return row;
}

async function activeAdmins(tx: Tx) {
  return tx.select({ id: users.id }).from(users).where(and(eq(users.role, "ADMIN"), eq(users.active, true)));
}

/** A member asks about one of their own payouts. */
export async function raiseQuestion(actor: Actor, entryId: string, raw: z.input<typeof questionInput>, request?: RequestMeta) {
  assertCan(actor, "payoutQuestion.raise");
  const input = questionInput.parse(raw);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ entry: payoutLedgerEntries, projectCode: projects.code, ownerId: projects.projectOwnerId })
      .from(payoutLedgerEntries)
      .innerJoin(projects, eq(projects.id, payoutLedgerEntries.projectId))
      .where(eq(payoutLedgerEntries.id, entryId));
    if (!row || row.entry.memberId !== actor.id) throw new ServiceError("You can only ask about your own payouts.");
    const earlier = await tx
      .select({ id: payoutQuestions.id })
      .from(payoutQuestions)
      .where(and(eq(payoutQuestions.ledgerEntryId, entryId), eq(payoutQuestions.raisedBy, actor.id)));
    const [question] = await tx
      .insert(payoutQuestions)
      .values({ ledgerEntryId: entryId, projectId: row.entry.projectId, raisedBy: actor.id, question: input.question })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "payout_question",
      entityId: question.id,
      projectId: row.entry.projectId,
      action: "payout_question.raised",
      after: { ledgerEntryId: entryId, question: input.question, earlierQuestions: earlier.length },
      request,
    });
    await notify(tx, actor, {
      recipientId: row.ownerId,
      type: "payout_question.raised",
      title: `Payout question on ${row.projectCode}`,
      message: input.question.slice(0, 200),
      entityType: "payout",
      entityId: entryId,
    });
    return question;
  });
}

/** A PM's review: settle with no change, or pass to an Admin for an adjustment. */
export async function reviewQuestion(actor: Actor, questionId: string, raw: z.input<typeof reviewInput>, request?: RequestMeta) {
  assertCan(actor, "payoutQuestion.review");
  const input = reviewInput.parse(raw);
  return withActor(actor, async (tx) => {
    const { question, projectCode } = await loadQuestion(tx, questionId);
    if (question.status !== "OPEN") throw new ServiceError("This question has already been reviewed.");
    if (question.raisedBy === actor.id && actor.role !== "ADMIN") {
      throw new ServiceError("Someone else must review a question you raised.");
    }
    const now = new Date();
    const noChange = input.outcome === "NO_CHANGE";
    const [updated] = await tx
      .update(payoutQuestions)
      .set({
        status: noChange ? "RESOLVED" : "AWAITING_ADMIN",
        reviewNote: input.note,
        reviewedBy: actor.id,
        reviewedAt: now,
        ...(noChange ? { resolution: input.note, resolvedBy: actor.id, resolvedAt: now } : {}),
      })
      .where(eq(payoutQuestions.id, questionId))
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "payout_question",
      entityId: questionId,
      projectId: question.projectId,
      action: noChange ? "payout_question.resolved" : "payout_question.reviewed",
      before: { status: question.status },
      after: { status: updated.status, outcome: input.outcome },
      reason: input.note,
      request,
    });
    await notify(tx, actor, {
      recipientId: question.raisedBy,
      type: noChange ? "payout_question.resolved" : "payout_question.reviewed",
      title: noChange ? `Your payout question on ${projectCode} was answered` : `Your payout question on ${projectCode} went to an Admin`,
      message: input.note.slice(0, 200),
      entityType: "payout",
      entityId: question.ledgerEntryId,
    });
    if (!noChange) {
      for (const admin of await activeAdmins(tx)) {
        await notify(tx, actor, {
          recipientId: admin.id,
          type: "payout_question.awaiting_admin",
          title: `Adjustment requested on ${projectCode}`,
          message: input.note.slice(0, 200),
          entityType: "payout",
          entityId: question.ledgerEntryId,
        });
      }
    }
    return updated;
  });
}

/** An Admin settles a question, optionally recording the adjustment in the same transaction. */
export async function resolveQuestion(actor: Actor, questionId: string, raw: z.input<typeof resolveInput>, request?: RequestMeta) {
  assertCan(actor, "payoutQuestion.resolve");
  const input = resolveInput.parse(raw);
  const adjustment = input.adjustment === undefined ? null : adjustmentInput.parse(input.adjustment);
  return withActor(actor, async (tx) => {
    const { question, projectCode } = await loadQuestion(tx, questionId);
    if (question.status === "RESOLVED") throw new ServiceError("This question is already resolved.");
    const created = adjustment ? await createAdjustmentTx(tx, actor, question.ledgerEntryId, adjustment, request) : null;
    const now = new Date();
    const [updated] = await tx
      .update(payoutQuestions)
      .set({
        status: "RESOLVED",
        resolution: input.resolution,
        resolvedBy: actor.id,
        resolvedAt: now,
        adjustmentId: created?.adjustment.id ?? null,
      })
      .where(eq(payoutQuestions.id, questionId))
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "payout_question",
      entityId: questionId,
      projectId: question.projectId,
      action: "payout_question.resolved",
      before: { status: question.status },
      after: { status: "RESOLVED", adjustmentId: updated.adjustmentId },
      reason: input.resolution,
      request,
    });
    await notify(tx, actor, {
      recipientId: question.raisedBy,
      type: "payout_question.resolved",
      title: `Your payout question on ${projectCode} was resolved`,
      message: `${input.resolution.slice(0, 180)}${created ? " (an adjustment was recorded)" : ""}`,
      entityType: "payout",
      entityId: question.ledgerEntryId,
    });
    return updated;
  });
}

async function selectQuestions(tx: Tx, where: SQL | undefined) {
  const raiser = aliasedTable(users, "raiser");
  const rows = await tx
    .select({ row: payoutQuestions, projectCode: projects.code, projectName: projects.name, raisedByName: raiser.name })
    .from(payoutQuestions)
    .innerJoin(projects, eq(projects.id, payoutQuestions.projectId))
    .innerJoin(raiser, eq(raiser.id, payoutQuestions.raisedBy))
    .where(where)
    .orderBy(desc(payoutQuestions.createdAt));
  // Reviewer and resolver names in a second query (two nullable joins on users confuse the types).
  const ids = [...new Set(rows.flatMap((r) => [r.row.reviewedBy, r.row.resolvedBy]).filter((id): id is string => id !== null))];
  const names = new Map(
    ids.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : [],
  );
  return rows.map(({ row, ...rest }) => ({
    ...row,
    ...rest,
    reviewedByName: row.reviewedBy ? (names.get(row.reviewedBy) ?? null) : null,
    resolvedByName: row.resolvedBy ? (names.get(row.resolvedBy) ?? null) : null,
  }));
}

/** Questions on one payout: the member sees their own, managers see all (row-level security). */
export async function questionsForPayout(actor: Actor, entryId: string) {
  return withActor(actor, (tx) => selectQuestions(tx, eq(payoutQuestions.ledgerEntryId, entryId)));
}

export const questionFilters = z.object({
  status: z.enum(["OPEN", "AWAITING_ADMIN", "RESOLVED"]).optional().catch(undefined),
});

/** Managers' queue of questions. */
export async function listQuestions(actor: Actor, raw: z.input<typeof questionFilters> = {}) {
  assertCan(actor, "payoutQuestion.review");
  const filters = questionFilters.parse(raw);
  return withActor(actor, (tx) => selectQuestions(tx, filters.status ? eq(payoutQuestions.status, filters.status) : undefined));
}

/** Counts for the navigation badge: what is waiting on this person. */
export async function questionsWaitingOn(actor: Actor): Promise<number> {
  if (actor.role === "TEAM_MEMBER") return 0;
  const statuses: ("OPEN" | "AWAITING_ADMIN")[] = actor.role === "ADMIN" ? ["OPEN", "AWAITING_ADMIN"] : ["OPEN"];
  return withActor(actor, async (tx) => {
    const rows = await tx.select({ id: payoutQuestions.id }).from(payoutQuestions).where(inArray(payoutQuestions.status, statuses));
    return rows.length;
  });
}
