import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { billingStages, changeRequests, invoiceLines, invoices, milestones, organizations, projects } from "@/lib/db/schema";
import { addWorkingDays, todayInOperatingZone } from "@/lib/dates";
import { FULL_BASIS_POINTS, formatMoney, parseMoney, parsePercent } from "@/lib/money";
import { type Actor, assertCan, can } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { draftProjectInvoiceTx } from "@/modules/invoices";
import { isEditable } from "@/modules/projects/rules";

// Phase 29: the client money flow for client (external) projects.
//   Payment plan: the project's value split into stages (deposit, milestones, final payment,
//   approved change requests), each invoiced on its own; its status follows the invoice.
//   Client sign-off: a stage's work is sent for review and the client's acceptance is recorded,
//   with a review deadline in working days (company setting).
//   Change requests: priced extra work; once the client approves, it adds to the project's value
//   and to the payment plan.
// Managers with "Create and edit projects" change plans; invoicing needs "Invoices".

export type StageKind = "DEPOSIT" | "MILESTONE" | "FINAL" | "CHANGE";
export type StageStatus = "NOT_INVOICED" | "DRAFT" | "INVOICED" | "PART_PAID" | "PAID";

export type Stage = {
  id: string;
  position: number;
  kind: StageKind;
  label: string;
  amountMinor: number;
  milestoneId: string | null;
  milestoneTitle: string | null;
  status: StageStatus;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** What the client has paid towards this stage (its share of the invoice's payments). */
  paidMinor: number;
  reviewSentOn: string | null;
  /** The working day by which the client should answer (from the company's review days). */
  reviewDueOn: string | null;
  signedOffOn: string | null;
  signOffNote: string | null;
};

export type ChangeRequest = typeof changeRequests.$inferSelect;

export type MoneyFlowSettings = { defaultDepositBasisPoints: number; requireDeposit: boolean; clientReviewDays: number; payoutRelease: "ON_APPROVAL" | "ON_CLIENT_PAYMENT" };

export const canSeeBilling = (actor: Actor) => can(actor, "project.edit") || can(actor, "invoice.view");

export async function moneyFlowSettings(tx: Tx, orgId: string): Promise<MoneyFlowSettings> {
  const [o] = await tx
    .select({
      defaultDepositBasisPoints: organizations.defaultDepositBasisPoints,
      requireDeposit: organizations.requireDeposit,
      clientReviewDays: organizations.clientReviewDays,
      payoutRelease: organizations.payoutRelease,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return { ...o, payoutRelease: o.payoutRelease as MoneyFlowSettings["payoutRelease"] };
}

async function loadStages(tx: Tx, projectId: string, reviewDays: number): Promise<Stage[]> {
  const rows = await tx
    .select({
      stage: billingStages,
      milestoneTitle: milestones.title,
      lineVoided: invoiceLines.voided,
      lineAmount: invoiceLines.amountMinor,
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      invoiceStatus: invoices.status,
      invoiceTotal: invoices.totalMinor,
      invoicePaid: invoices.paidMinor,
    })
    .from(billingStages)
    .leftJoin(milestones, eq(milestones.id, billingStages.milestoneId))
    .leftJoin(invoiceLines, eq(invoiceLines.id, billingStages.invoiceLineId))
    .leftJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(eq(billingStages.projectId, projectId))
    .orderBy(asc(billingStages.position));
  return rows.map((r) => {
    const live = r.invoiceId !== null && !r.lineVoided && r.invoiceStatus !== "VOID";
    let status: StageStatus = "NOT_INVOICED";
    let paidMinor = 0;
    if (live && r.invoiceStatus === "DRAFT") status = "DRAFT";
    else if (live && r.invoiceStatus === "ISSUED") {
      paidMinor = r.invoiceTotal! > 0 ? Math.floor((r.lineAmount! * Math.min(r.invoicePaid!, r.invoiceTotal!)) / r.invoiceTotal!) : 0;
      status = paidMinor >= r.stage.amountMinor ? "PAID" : paidMinor > 0 ? "PART_PAID" : "INVOICED";
    }
    return {
      id: r.stage.id,
      position: r.stage.position,
      kind: r.stage.kind as StageKind,
      label: r.stage.label,
      amountMinor: r.stage.amountMinor,
      milestoneId: r.stage.milestoneId,
      milestoneTitle: r.milestoneTitle,
      status,
      invoiceId: live ? r.invoiceId : null,
      invoiceNumber: live ? r.invoiceNumber : null,
      paidMinor,
      reviewSentOn: r.stage.reviewSentOn,
      reviewDueOn: r.stage.reviewSentOn && !r.stage.signedOffOn ? addWorkingDays(r.stage.reviewSentOn, reviewDays) : null,
      signedOffOn: r.stage.signedOffOn,
      signOffNote: r.stage.signOffNote,
    };
  });
}

/** The project's payment plan, change requests and what the client has paid. Managers only. */
export async function getBilling(actor: Actor, projectId: string) {
  if (!canSeeBilling(actor)) return null;
  return withActor(actor, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    const settings = await moneyFlowSettings(tx, actor.orgId);
    const stages = await loadStages(tx, projectId, settings.clientReviewDays);
    const changes = await tx.select().from(changeRequests).where(eq(changeRequests.projectId, projectId)).orderBy(asc(changeRequests.createdAt));
    const clientPaid = Number((await tx.execute<{ paid: string }>(sql`select app_project_client_paid(${projectId}) as paid`)).rows[0].paid);
    const plannedMinor = stages.reduce((n, s) => n + s.amountMinor, 0);
    const deposit = stages.find((s) => s.kind === "DEPOSIT") ?? null;
    return {
      project,
      settings,
      stages,
      changes,
      clientPaidMinor: clientPaid,
      plannedMinor,
      unplannedMinor: project.totalValueMinor - plannedMinor,
      depositPaid: deposit ? deposit.status === "PAID" : null,
    };
  });
}

// --- Plan ------------------------------------------------------------------------------------

async function lockClientProject(tx: Tx, projectId: string) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  if (!project) throw new ServiceError("Project not found.");
  if (project.clientType !== "EXTERNAL") throw new ServiceError("Payment plans are for client projects. This is an internal project.");
  if (project.status === "CANCELLED") throw new ServiceError("This project is cancelled.");
  return project;
}

async function nextStagePosition(tx: Tx, projectId: string) {
  const [row] = await tx.select({ max: sql<number | null>`max(${billingStages.position})` }).from(billingStages).where(eq(billingStages.projectId, projectId));
  return (row?.max ?? 0) + 1;
}

async function plannedTotal(tx: Tx, projectId: string, exceptId?: string) {
  const rows = await tx.select({ id: billingStages.id, amount: billingStages.amountMinor }).from(billingStages).where(eq(billingStages.projectId, projectId));
  return rows.filter((r) => r.id !== exceptId).reduce((n, r) => n + r.amount, 0);
}

export const PRESETS = {
  HALF: { label: "50% upfront, 50% on completion", parts: [["DEPOSIT", "Deposit", 5000], ["FINAL", "Final payment", 5000]] },
  THIRDS: { label: "40% upfront, 30% at the middle milestone, 30% on completion", parts: [["DEPOSIT", "Deposit", 4000], ["MILESTONE", "Milestone payment", 3000], ["FINAL", "Final payment", 3000]] },
  UPFRONT: { label: "100% upfront", parts: [["DEPOSIT", "Full payment upfront", 10000]] },
  ON_COMPLETION: { label: "100% on completion", parts: [["FINAL", "Payment on completion", 10000]] },
} as const satisfies Record<string, { label: string; parts: readonly (readonly [StageKind, string, number])[] }>;
export type PresetKey = keyof typeof PRESETS;

/**
 * Replaces the plan's stages that aren't invoiced yet (change requests stay) with a common split
 * of what's left of the project's value. Amounts are whole pesewas; the last stage takes any
 * rounding remainder.
 */
export async function applyPreset(actor: Actor, projectId: string, preset: PresetKey, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const parts = PRESETS[preset]?.parts;
  if (!parts) throw new ServiceError("Choose a payment plan.");
  await withActor(actor, async (tx) => {
    const project = await lockClientProject(tx, projectId);
    const settings = await moneyFlowSettings(tx, actor.orgId);
    const stages = await loadStages(tx, projectId, settings.clientReviewDays);
    if (stages.some((s) => s.kind !== "CHANGE" && s.status !== "NOT_INVOICED")) {
      throw new ServiceError("Part of the plan is already invoiced. Change the stages one by one instead.");
    }
    const removable = stages.filter((s) => s.kind !== "CHANGE").map((s) => s.id);
    if (removable.length) await tx.delete(billingStages).where(inArray(billingStages.id, removable)).catch(rethrowDbGuard);
    const base = project.totalValueMinor - stages.filter((s) => s.kind === "CHANGE").reduce((n, s) => n + s.amountMinor, 0);
    if (base <= 0) throw new ServiceError("Set the project's value first.");
    // A company's usual deposit replaces the 50% of the simple split.
    const shares: number[] = parts.map(([kind, , bp]) => (preset === "HALF" && kind === "DEPOSIT" ? settings.defaultDepositBasisPoints || bp : bp));
    if (preset === "HALF") shares[1] = FULL_BASIS_POINTS - shares[0];
    let position = await nextStagePosition(tx, projectId);
    let allocated = 0;
    const rows = parts
      .map(([kind, label], i) => {
        const last = i === parts.length - 1;
        const amount = last ? base - allocated : Math.floor((base * shares[i]) / FULL_BASIS_POINTS);
        allocated += amount;
        return { projectId, position: position++, kind, label: `${label} (${(shares[i] / 100).toFixed(0)}%)`, amountMinor: amount, createdBy: actor.id };
      })
      .filter((r) => r.amountMinor > 0);
    await tx.insert(billingStages).values(rows).catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "billing.plan_set",
      after: { preset, stages: rows.map((r) => ({ label: r.label, amountMinor: r.amountMinor })) },
      request,
    });
  });
}

const amountOrPercent = z
  .string()
  .trim()
  .min(1, "Enter an amount (e.g. 2500.00) or a percentage (e.g. 30%)");

export const stageInput = z.object({
  label: z.string().trim().min(2, "Name the payment, e.g. Deposit").max(120),
  kind: z.enum(["DEPOSIT", "MILESTONE", "FINAL"]),
  amount: amountOrPercent,
  milestoneId: z
    .union([z.uuid(), z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});

/** "30%" is a share of the project's value; anything else is an amount in GHS. */
function resolveAmount(raw: string, projectValue: number): number {
  if (raw.endsWith("%")) {
    const bp = parsePercent(raw.slice(0, -1));
    if (bp === null || bp <= 0 || bp > FULL_BASIS_POINTS) throw new ServiceError("Enter a percentage between 0 and 100, e.g. 30%.");
    return Math.floor((projectValue * bp) / FULL_BASIS_POINTS);
  }
  const minor = parseMoney(raw);
  if (minor === null || minor <= 0) throw new ServiceError("Enter an amount in GHS, e.g. 2500.00, or a percentage, e.g. 30%.");
  return minor;
}

async function checkMilestone(tx: Tx, projectId: string, milestoneId: string | null | undefined) {
  if (!milestoneId) return;
  const [m] = await tx.select({ projectId: milestones.projectId }).from(milestones).where(eq(milestones.id, milestoneId));
  if (!m || m.projectId !== projectId) throw new ServiceError("That milestone belongs to another project.");
}

export async function addStage(actor: Actor, projectId: string, raw: z.input<typeof stageInput>, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const input = stageInput.parse(raw);
  await withActor(actor, async (tx) => {
    const project = await lockClientProject(tx, projectId);
    const amount = resolveAmount(input.amount, project.totalValueMinor);
    await checkMilestone(tx, projectId, input.milestoneId);
    const planned = await plannedTotal(tx, projectId);
    if (planned + amount > project.totalValueMinor) {
      throw new ServiceError(`That's more than the project's value: ${formatMoney(project.totalValueMinor - planned)} is left to plan.`);
    }
    const [stage] = await tx
      .insert(billingStages)
      .values({ projectId, position: await nextStagePosition(tx, projectId), kind: input.kind, label: input.label, amountMinor: amount, milestoneId: input.milestoneId ?? null, createdBy: actor.id })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "billing_stage", entityId: stage.id, projectId, action: "billing.stage_added", after: { label: stage.label, kind: stage.kind, amountMinor: amount }, request });
  });
}

export async function updateStage(actor: Actor, stageId: string, raw: z.input<typeof stageInput>, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const input = stageInput.parse(raw);
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(billingStages).where(eq(billingStages.id, stageId));
    if (!before) throw new ServiceError("Payment stage not found.");
    if (before.kind === "CHANGE") throw new ServiceError("This payment comes from an approved change request and can't be edited.");
    const project = await lockClientProject(tx, before.projectId);
    const amount = resolveAmount(input.amount, project.totalValueMinor);
    await checkMilestone(tx, before.projectId, input.milestoneId);
    const planned = await plannedTotal(tx, before.projectId, stageId);
    if (planned + amount > project.totalValueMinor) {
      throw new ServiceError(`That's more than the project's value: ${formatMoney(project.totalValueMinor - planned)} is left to plan.`);
    }
    await tx
      .update(billingStages)
      .set({ label: input.label, kind: input.kind, amountMinor: amount, milestoneId: input.milestoneId ?? null })
      .where(eq(billingStages.id, stageId))
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "billing_stage",
      entityId: stageId,
      projectId: before.projectId,
      action: "billing.stage_changed",
      before: { label: before.label, kind: before.kind, amountMinor: before.amountMinor },
      after: { label: input.label, kind: input.kind, amountMinor: amount },
      request,
    });
  });
}

export async function removeStage(actor: Actor, stageId: string, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(billingStages).where(eq(billingStages.id, stageId));
    if (!before) throw new ServiceError("Payment stage not found.");
    await tx.delete(billingStages).where(eq(billingStages.id, stageId)).catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "billing_stage", entityId: stageId, projectId: before.projectId, action: "billing.stage_removed", before: { label: before.label, amountMinor: before.amountMinor }, request });
  });
}

/** A draft invoice for one payment stage, for the project's customer. Returns the invoice id. */
export async function invoiceStage(actor: Actor, stageId: string, request?: RequestMeta): Promise<string> {
  assertCan(actor, "invoice.manage");
  return withActor(actor, async (tx) => {
    const [stage] = await tx.select().from(billingStages).where(eq(billingStages.id, stageId)).for("update");
    if (!stage) throw new ServiceError("Payment stage not found.");
    const project = await lockClientProject(tx, stage.projectId);
    if (!project.customerId) throw new ServiceError("Link this project to a customer first (project details), so the invoice knows who to bill.");
    const settings = await moneyFlowSettings(tx, actor.orgId);
    const current = (await loadStages(tx, stage.projectId, settings.clientReviewDays)).find((s) => s.id === stageId)!;
    if (current.status !== "NOT_INVOICED") throw new ServiceError("This payment is already on an invoice.");
    const { invoiceId, lineId } = await draftProjectInvoiceTx(
      tx,
      actor,
      { customerId: project.customerId, projectId: project.id, description: `${project.code} ${project.name}: ${stage.label}`, amountMinor: stage.amountMinor },
      request,
    );
    await tx.update(billingStages).set({ invoiceLineId: lineId }).where(eq(billingStages.id, stageId)).catch(rethrowDbGuard);
    return invoiceId;
  });
}

// --- Client sign-off -------------------------------------------------------------------------

const day = z.iso.date("Enter a date");

export async function sendForReview(actor: Actor, stageId: string, raw: { on: string }, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const on = day.parse(raw.on);
  if (on > todayInOperatingZone()) throw new ServiceError("The date can't be in the future.");
  await withActor(actor, async (tx) => {
    const [stage] = await tx.select().from(billingStages).where(eq(billingStages.id, stageId));
    if (!stage) throw new ServiceError("Payment stage not found.");
    if (stage.signedOffOn) throw new ServiceError("The client has already signed this off.");
    await tx.update(billingStages).set({ reviewSentOn: on }).where(eq(billingStages.id, stageId));
    await recordAudit(tx, { actorId: actor.id, entityType: "billing_stage", entityId: stageId, projectId: stage.projectId, action: "billing.sent_for_review", after: { label: stage.label, on }, request });
  });
}

export const signOffInput = z.object({
  on: day,
  note: z.string().trim().min(3, "Say how the client accepted, e.g. 'Email from Ama, 12 Oct'").max(1000),
});

/** Records that the client accepted the work for this stage (how and when, for the record). */
export async function recordSignOff(actor: Actor, stageId: string, raw: z.input<typeof signOffInput>, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const input = signOffInput.parse(raw);
  if (input.on > todayInOperatingZone()) throw new ServiceError("The date can't be in the future.");
  await withActor(actor, async (tx) => {
    const [stage] = await tx.select().from(billingStages).where(eq(billingStages.id, stageId));
    if (!stage) throw new ServiceError("Payment stage not found.");
    if (stage.signedOffOn) throw new ServiceError("The client has already signed this off.");
    await tx.update(billingStages).set({ signedOffOn: input.on, signedOffBy: actor.id, signOffNote: input.note }).where(eq(billingStages.id, stageId)).catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "billing_stage", entityId: stageId, projectId: stage.projectId, action: "billing.signed_off", after: { label: stage.label, on: input.on }, reason: input.note, request });
  });
}

// --- Deposit rule ----------------------------------------------------------------------------

/**
 * "No deposit, no work": with the company setting on, a client project starts only once its
 * deposit is paid. Returns why it can't start yet, or null.
 */
export async function depositBlock(tx: Tx, orgId: string, project: typeof projects.$inferSelect): Promise<string | null> {
  if (project.clientType !== "EXTERNAL") return null;
  const settings = await moneyFlowSettings(tx, orgId);
  if (!settings.requireDeposit) return null;
  const stages = await loadStages(tx, project.id, settings.clientReviewDays);
  const deposit = stages.find((s) => s.kind === "DEPOSIT");
  if (!deposit) return "This company starts client work only after a deposit, and this project's payment plan has no deposit. Add one on the Billing tab, or give a reason to start anyway.";
  if (deposit.status === "PAID") return null;
  return `The deposit (${formatMoney(deposit.amountMinor)}) isn't paid yet. Record the client's payment on its invoice, or give a reason to start anyway.`;
}

// --- Change requests -------------------------------------------------------------------------

export const changeRequestInput = z.object({
  title: z.string().trim().min(3, "Say what the client asked for").max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  amount: z.string().transform((v, ctx) => {
    const minor = v.trim() === "" ? 0 : parseMoney(v);
    if (minor === null || minor < 0) {
      ctx.addIssue({ code: "custom", message: "Enter the extra price in GHS, e.g. 2000.00 (0 if free)" });
      return z.NEVER;
    }
    return minor;
  }),
  extraDays: z.coerce.number().int("Whole days").min(0, "0 to 365 days").max(365, "0 to 365 days"),
});

export async function createChangeRequest(actor: Actor, projectId: string, raw: z.input<typeof changeRequestInput>, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const input = changeRequestInput.parse(raw);
  await withActor(actor, async (tx) => {
    await lockClientProject(tx, projectId);
    const [row] = await tx
      .insert(changeRequests)
      .values({ projectId, title: input.title, description: input.description ?? null, amountMinor: input.amount, extraDays: input.extraDays, createdBy: actor.id })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "change_request", entityId: row.id, projectId, action: "change_request.created", after: { title: row.title, amountMinor: row.amountMinor, extraDays: row.extraDays }, request });
  });
}

export async function markChangeRequestSent(actor: Actor, changeId: string, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  await withActor(actor, async (tx) => {
    const [cr] = await tx.select().from(changeRequests).where(eq(changeRequests.id, changeId));
    if (!cr) throw new ServiceError("Change request not found.");
    if (cr.status !== "DRAFT") throw new ServiceError("Only a draft can be sent to the client.");
    await tx.update(changeRequests).set({ status: "SENT" }).where(eq(changeRequests.id, changeId)).catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "change_request", entityId: changeId, projectId: cr.projectId, action: "change_request.sent", after: { title: cr.title }, request });
  });
}

export const decisionInput = z.object({
  approve: z.boolean(),
  on: day,
  note: z.string().trim().min(3, "Say how the client decided, e.g. 'Approved by email, 14 Oct'").max(1000),
});

/**
 * The client's answer. Approved: the price is added to the project's value and to the payment
 * plan, and the target date moves by the extra days. The project must still be editable.
 */
export async function decideChangeRequest(actor: Actor, changeId: string, raw: z.input<typeof decisionInput>, request?: RequestMeta) {
  assertCan(actor, "project.edit");
  const input = decisionInput.parse(raw);
  if (input.on > todayInOperatingZone()) throw new ServiceError("The date can't be in the future.");
  await withActor(actor, async (tx) => {
    const [cr] = await tx.select().from(changeRequests).where(eq(changeRequests.id, changeId)).for("update");
    if (!cr) throw new ServiceError("Change request not found.");
    if (cr.status === "APPROVED" || cr.status === "REJECTED") throw new ServiceError("This change request has already been decided.");
    const project = await lockClientProject(tx, cr.projectId);
    if (input.approve && !isEditable(project.status)) {
      throw new ServiceError("The project is locked (waiting for approval or completed). Reopen it before adding approved changes.");
    }
    await tx
      .update(changeRequests)
      .set({ status: input.approve ? "APPROVED" : "REJECTED", decidedOn: input.on, decisionNote: input.note, decidedBy: actor.id })
      .where(eq(changeRequests.id, changeId))
      .catch(rethrowDbGuard);
    if (input.approve) {
      const target = project.targetDate && cr.extraDays > 0 ? new Date(new Date(`${project.targetDate}T12:00:00Z`).getTime() + cr.extraDays * 86_400_000).toISOString().slice(0, 10) : project.targetDate;
      await tx
        .update(projects)
        .set({ totalValueMinor: project.totalValueMinor + cr.amountMinor, targetDate: target, version: project.version + 1 })
        .where(eq(projects.id, project.id))
        .catch(rethrowDbGuard);
      if (cr.amountMinor > 0) {
        await tx
          .insert(billingStages)
          .values({ projectId: project.id, position: await nextStagePosition(tx, project.id), kind: "CHANGE", label: `Change: ${cr.title}`.slice(0, 120), amountMinor: cr.amountMinor, changeRequestId: cr.id, createdBy: actor.id })
          .catch(rethrowDbGuard);
      }
      await recordAudit(tx, {
        actorId: actor.id,
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        action: "project.value_changed",
        before: { totalValueMinor: project.totalValueMinor, targetDate: project.targetDate },
        after: { totalValueMinor: project.totalValueMinor + cr.amountMinor, targetDate: target, changeRequest: cr.title },
        request,
      });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "change_request",
      entityId: changeId,
      projectId: cr.projectId,
      action: input.approve ? "change_request.approved" : "change_request.rejected",
      after: { title: cr.title, amountMinor: cr.amountMinor, on: input.on },
      reason: input.note,
      request,
    });
  });
}

// --- Company settings ------------------------------------------------------------------------

export const moneyFlowInput = z.object({
  defaultDeposit: z.string().transform((v, ctx) => {
    const bp = parsePercent(v.replace("%", ""));
    if (bp === null || bp < 0 || bp > FULL_BASIS_POINTS) {
      ctx.addIssue({ code: "custom", message: "Enter the usual deposit as a percentage from 0 to 100, e.g. 50" });
      return z.NEVER;
    }
    return bp;
  }),
  requireDeposit: z.boolean(),
  clientReviewDays: z.coerce.number().int("Whole working days").min(1, "1 to 60 working days").max(60, "1 to 60 working days"),
  payoutRelease: z.enum(["ON_APPROVAL", "ON_CLIENT_PAYMENT"]),
});

export async function getMoneyFlowSettings(actor: Actor): Promise<MoneyFlowSettings> {
  return withActor(actor, (tx) => moneyFlowSettings(tx, actor.orgId));
}

export async function updateMoneyFlowSettings(actor: Actor, raw: z.input<typeof moneyFlowInput>, request?: RequestMeta) {
  assertCan(actor, "company.manage");
  const input = moneyFlowInput.parse(raw);
  await withActor(actor, async (tx) => {
    const before = await moneyFlowSettings(tx, actor.orgId);
    const after = { defaultDepositBasisPoints: input.defaultDeposit, requireDeposit: input.requireDeposit, clientReviewDays: input.clientReviewDays, payoutRelease: input.payoutRelease };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await tx.update(organizations).set(after).where(eq(organizations.id, actor.orgId)).catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "organization", entityId: actor.orgId, action: "company.money_flow_changed", before, after, request });
  });
}

/** How much of a payout may be paid now (all of it unless the company pays in step with the client). */
export async function releasableMinor(tx: Tx, entryId: string): Promise<number> {
  return Number((await tx.execute<{ r: string }>(sql`select app_payout_releasable(${entryId}) as r`)).rows[0].r);
}
