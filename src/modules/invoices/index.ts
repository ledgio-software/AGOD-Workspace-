import { and, asc, desc, eq, ilike, isNull, max, ne, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import {
  auditEvents,
  customerContacts,
  customers,
  invoiceLines,
  invoicePayments,
  invoiceSettings,
  invoices,
  notifications,
  projects,
  subscriptions,
  users,
} from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { DEFAULT_CURRENCY, formatMoney, parseMoney } from "@/lib/money";
import { type Actor, assertCan, can } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { addDays } from "@/modules/notifications/deadlines";
import {
  type InvoiceState,
  balanceMinor,
  formatInvoiceNumber,
  invoiceAlerts,
  invoiceState,
  nextBillingPeriod,
} from "./rules";

// Phase 20: invoices. Drafts are prepared by PMs and Admins (manual lines, subscription periods,
// project amounts), then issued: that assigns the number, copies the bill-to details and freezes
// the lines (enforced by triggers). Admins record the customer's payments. Nothing issued is
// deleted: invoices and payments are voided with a reason.

type InvoiceRow = typeof invoices.$inferSelect;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();
const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500);
const money = (label: string) =>
  z.string().transform((v, ctx) => {
    const minor = parseMoney(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: `Enter the ${label} in GHS, e.g. 450.00` });
      return z.NEVER;
    }
    return minor;
  });

function describePeriod(start: string, end: string): string {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return start === end ? f(start) : `${f(start)} – ${f(end)}`;
}

function auditableInvoice(i: InvoiceRow) {
  return { number: i.number, status: i.status, issueDate: i.issueDate, dueDate: i.dueDate, totalMinor: i.totalMinor, paidMinor: i.paidMinor };
}

async function lockInvoice(tx: Tx, invoiceId: string): Promise<InvoiceRow> {
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
  if (!invoice) throw new ServiceError("Invoice not found.");
  return invoice;
}

function assertDraft(invoice: InvoiceRow) {
  if (invoice.status !== "DRAFT") throw new ServiceError("Only draft invoices can be changed. Void it and create a new one.");
}

async function refreshTotal(tx: Tx, invoice: InvoiceRow): Promise<number> {
  const [row] = await tx.select({ total: sum(invoiceLines.amountMinor) }).from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id));
  const total = Number(row?.total ?? 0);
  await tx.update(invoices).set({ totalMinor: total, version: invoice.version + 1, updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
  return total;
}

async function nextPosition(tx: Tx, invoiceId: string): Promise<number> {
  const [row] = await tx.select({ max: max(invoiceLines.position) }).from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------------------------
// Drafts

export const draftInput = z.object({ customerId: z.uuid("Choose a customer"), notes: optionalText(2000) });

export async function createDraftInvoice(actor: Actor, raw: z.input<typeof draftInput>, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  const input = draftInput.parse(raw);
  return withActor(actor, async (tx) => createDraftTx(tx, actor, input.customerId, input.notes ?? null, request));
}

async function createDraftTx(tx: Tx, actor: Actor, customerId: string, notes: string | null, request?: RequestMeta) {
  const [customer] = await tx.select({ name: customers.name, status: customers.status }).from(customers).where(eq(customers.id, customerId));
  if (!customer) throw new ServiceError("Customer not found.");
  if (customer.status === "ARCHIVED") throw new ServiceError(`${customer.name} is archived. Restore it first.`);
  const [created] = await tx.insert(invoices).values({ customerId, notes, currency: DEFAULT_CURRENCY, createdBy: actor.id }).returning();
  await recordAudit(tx, { actorId: actor.id, entityType: "invoice", entityId: created.id, action: "invoice.created", after: { customerId }, request });
  return created;
}

export const lineInput = z.object({
  description: z.string().trim().min(2, "Describe the line").max(500),
  quantity: z.coerce.number().int("Use a whole number").min(1, "At least 1").max(100_000),
  unitPrice: money("price"),
  /** Optional: the project this amount bills (e.g. a deposit or milestone payment). */
  projectId: z
    .union([z.uuid(), z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullish(),
});

/** How much of a project has been billed on invoices that are not void. */
async function projectBilledMinor(tx: Tx, projectId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sum(invoiceLines.amountMinor) })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(invoiceLines.projectId, projectId), ne(invoices.status, "VOID")));
  return Number(row?.total ?? 0);
}

export async function addInvoiceLine(actor: Actor, invoiceId: string, raw: z.input<typeof lineInput>, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  const input = lineInput.parse(raw);
  await withActor(actor, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    assertDraft(invoice);
    const amount = input.quantity * input.unitPrice;
    if (input.projectId) {
      const [project] = await tx
        .select({ code: projects.code, customerId: projects.customerId, totalValueMinor: projects.totalValueMinor, status: projects.status })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .for("update");
      if (!project) throw new ServiceError("Project not found.");
      if (project.customerId !== invoice.customerId) throw new ServiceError(`${project.code} belongs to another customer.`);
      if (project.status === "CANCELLED") throw new ServiceError(`${project.code} is cancelled.`);
      const billed = await projectBilledMinor(tx, input.projectId);
      if (billed + amount > project.totalValueMinor) {
        throw new ServiceError(
          `That would bill more than ${project.code}'s value: ${formatMoney(billed)} of ${formatMoney(project.totalValueMinor)} is already on invoices.`,
        );
      }
    }
    await tx
      .insert(invoiceLines)
      .values({
        invoiceId,
        position: await nextPosition(tx, invoiceId),
        description: input.description,
        quantity: input.quantity,
        unitPriceMinor: input.unitPrice,
        amountMinor: amount,
        projectId: input.projectId ?? null,
      })
      .catch(rethrowDbGuard);
    await refreshTotal(tx, invoice);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "invoice",
      entityId: invoiceId,
      action: "invoice.line_added",
      after: { description: input.description, amountMinor: amount, projectId: input.projectId ?? null },
      request,
    });
  });
}

/**
 * Phase 29: a new draft invoice billing one payment stage of a project, in the caller's
 * transaction (the caller checks `invoice.manage`). Returns the invoice and its line.
 */
export async function draftProjectInvoiceTx(
  tx: Tx,
  actor: Actor,
  input: { customerId: string; projectId: string; description: string; amountMinor: number },
  request?: RequestMeta,
): Promise<{ invoiceId: string; lineId: string }> {
  const [project] = await tx
    .select({ code: projects.code, totalValueMinor: projects.totalValueMinor })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .for("update");
  if (!project) throw new ServiceError("Project not found.");
  const billed = await projectBilledMinor(tx, input.projectId);
  if (billed + input.amountMinor > project.totalValueMinor) {
    throw new ServiceError(`That would bill more than ${project.code}'s value: ${formatMoney(billed)} of ${formatMoney(project.totalValueMinor)} is already on invoices.`);
  }
  const invoice = await createDraftTx(tx, actor, input.customerId, null, request);
  const [line] = await tx
    .insert(invoiceLines)
    .values({ invoiceId: invoice.id, position: 1, description: input.description, quantity: 1, unitPriceMinor: input.amountMinor, amountMinor: input.amountMinor, projectId: input.projectId })
    .returning({ id: invoiceLines.id })
    .catch(rethrowDbGuard);
  await refreshTotal(tx, invoice);
  await recordAudit(tx, {
    actorId: actor.id,
    entityType: "invoice",
    entityId: invoice.id,
    action: "invoice.line_added",
    after: { description: input.description, amountMinor: input.amountMinor, projectId: input.projectId },
    request,
  });
  return { invoiceId: invoice.id, lineId: line.id };
}

/** Adds the subscription's next unbilled period to a draft. */
export async function addSubscriptionPeriod(actor: Actor, invoiceId: string, subscriptionId: string, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  await withActor(actor, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    assertDraft(invoice);
    await addSubscriptionPeriodTx(tx, actor, invoice, subscriptionId, request);
    await refreshTotal(tx, invoice);
  });
}

async function addSubscriptionPeriodTx(tx: Tx, actor: Actor, invoice: InvoiceRow, subscriptionId: string, request?: RequestMeta) {
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).for("update");
  if (!sub) throw new ServiceError("Subscription not found.");
  if (sub.customerId !== invoice.customerId) throw new ServiceError("That subscription belongs to another customer.");
  if (sub.status !== "ACTIVE") throw new ServiceError(`Only active subscriptions are billed (${sub.serviceName} is ${sub.status.toLowerCase()}).`);
  const period = nextBillingPeriod({ ...sub, lastPeriodEnd: await lastBilledPeriodEnd(tx, sub.id) });
  if (!period) {
    throw new ServiceError(
      sub.billingCadence === "CUSTOM"
        ? `${sub.serviceName} has custom billing: add it as a manual line.`
        : `${sub.serviceName} has no unbilled period left.`,
    );
  }
  await tx
    .insert(invoiceLines)
    .values({
      invoiceId: invoice.id,
      position: await nextPosition(tx, invoice.id),
      description: `${sub.serviceName} — ${describePeriod(period.start, period.end)}`,
      quantity: sub.quantity,
      unitPriceMinor: sub.priceMinor,
      amountMinor: sub.quantity * sub.priceMinor,
      subscriptionId: sub.id,
      periodStart: period.start,
      periodEnd: period.end,
    })
    .catch((error: unknown) => {
      if ((error as { cause?: { code?: string } }).cause?.code === "23505") throw new ServiceError("That period is already on another invoice.");
      rethrowDbGuard(error);
    });
  await recordAudit(tx, {
    actorId: actor.id,
    entityType: "invoice",
    entityId: invoice.id,
    action: "invoice.line_added",
    after: { subscriptionId: sub.id, periodStart: period.start, periodEnd: period.end, amountMinor: sub.quantity * sub.priceMinor },
    request,
  });
  return period;
}

async function lastBilledPeriodEnd(tx: Tx, subscriptionId: string): Promise<string | null> {
  const [row] = await tx
    .select({ end: max(invoiceLines.periodEnd) })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.subscriptionId, subscriptionId), eq(invoiceLines.voided, false)));
  return row?.end ?? null;
}

export async function removeInvoiceLine(actor: Actor, lineId: string, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  await withActor(actor, async (tx) => {
    const [line] = await tx.select().from(invoiceLines).where(eq(invoiceLines.id, lineId));
    if (!line) throw new ServiceError("Line not found.");
    const invoice = await lockInvoice(tx, line.invoiceId);
    assertDraft(invoice);
    await tx.delete(invoiceLines).where(eq(invoiceLines.id, lineId)).catch(rethrowDbGuard);
    await refreshTotal(tx, invoice);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "invoice",
      entityId: invoice.id,
      action: "invoice.line_removed",
      before: { description: line.description, amountMinor: line.amountMinor },
      request,
    });
  });
}

export async function updateDraftNotes(actor: Actor, invoiceId: string, raw: { notes?: string | null; version: number | string }, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  const notes = optionalText(2000).parse(raw.notes) ?? null;
  await withActor(actor, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    assertDraft(invoice);
    if (invoice.version !== Number(raw.version)) throw new ServiceError("Someone else changed this invoice meanwhile. Reload the page.");
    await tx.update(invoices).set({ notes, version: invoice.version + 1 }).where(eq(invoices.id, invoiceId));
    await recordAudit(tx, { actorId: actor.id, entityType: "invoice", entityId: invoiceId, action: "invoice.updated", after: { notes }, request });
  });
}

/** Drafts were never sent, so they can be thrown away. */
export async function deleteDraftInvoice(actor: Actor, invoiceId: string, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  await withActor(actor, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    assertDraft(invoice);
    await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    await tx.delete(invoices).where(eq(invoices.id, invoiceId)).catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "invoice", entityId: invoiceId, action: "invoice.draft_deleted", request });
  });
}

// ---------------------------------------------------------------------------------------------
// Issuing, voiding, payments

export const issueInput = z.object({
  issueDate: z.iso.date("Enter the issue date"),
  dueDate: z.iso.date("Enter the due date"),
  version: z.coerce.number().int(),
});

async function nextInvoiceNumber(tx: Tx, issueDate: string): Promise<string> {
  // Numbers run per company (row-level security limits the search below to it).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('invoice_number:' || app_org_id()::text))`);
  const year = issueDate.slice(0, 4);
  const prefix = `INV-${year}-`;
  const [row] = await tx
    .select({ max: sql<string | null>`max(substring(${invoices.number} from (${prefix.length + 1})::int)::int)::text` })
    .from(invoices)
    .where(sql`${invoices.number} like ${prefix + "%"}`);
  return formatInvoiceNumber(year, Number(row?.max ?? 0) + 1);
}

/** The billing contact, else the primary contact, else any active contact with an email. */
async function billingContact(tx: Tx, customerId: string) {
  const contacts = await tx
    .select({ name: customerContacts.name, email: customerContacts.email, isBilling: customerContacts.isBilling, isPrimary: customerContacts.isPrimary })
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customerId), eq(customerContacts.active, true)));
  const withEmail = contacts.filter((c) => c.email);
  return withEmail.find((c) => c.isBilling) ?? withEmail.find((c) => c.isPrimary) ?? withEmail[0] ?? null;
}

export async function issueInvoice(actor: Actor, invoiceId: string, raw: z.input<typeof issueInput>, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  const input = issueInput.parse(raw);
  if (input.dueDate < input.issueDate) throw new ServiceError("The due date cannot be before the issue date.");
  return withActor(actor, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    assertDraft(invoice);
    if (invoice.version !== input.version) throw new ServiceError("Someone else changed this invoice meanwhile. Reload the page.");
    const total = await refreshTotal(tx, invoice);
    if (total <= 0) throw new ServiceError("Add at least one line with an amount before issuing.");
    const [customer] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, invoice.customerId));
    const contact = await billingContact(tx, invoice.customerId);
    const number = await nextInvoiceNumber(tx, input.issueDate);
    const [issued] = await tx
      .update(invoices)
      .set({
        status: "ISSUED",
        number,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        billToName: contact ? `${customer.name} — attn. ${contact.name}` : customer.name,
        billToEmail: contact?.email ?? null,
        issuedBy: actor.id,
        issuedAt: new Date(),
        version: invoice.version + 2,
      })
      .where(eq(invoices.id, invoiceId))
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, { actorId: actor.id, entityType: "invoice", entityId: invoiceId, action: "invoice.issued", after: auditableInvoice(issued), request });
    return issued;
  });
}

export async function voidInvoice(actor: Actor, invoiceId: string, raw: { reason: string }, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  const why = reason.parse(raw.reason);
  await withActor(actor, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    if (invoice.status === "DRAFT") throw new ServiceError("Drafts are deleted, not voided.");
    if (invoice.status === "VOID") throw new ServiceError("This invoice is already void.");
    if (invoice.paidMinor > 0) throw new ServiceError("This invoice has payments. An Admin must void them first.");
    await tx
      .update(invoices)
      .set({ status: "VOID", voidedAt: new Date(), voidedBy: actor.id, voidReason: why, version: invoice.version + 1 })
      .where(eq(invoices.id, invoiceId))
      .catch(rethrowDbGuard);
    // Frees the billed subscription periods and project amounts so they can be billed again.
    await tx.update(invoiceLines).set({ voided: true }).where(eq(invoiceLines.invoiceId, invoiceId));
    await recordAudit(tx, { actorId: actor.id, entityType: "invoice", entityId: invoiceId, action: "invoice.voided", before: auditableInvoice(invoice), reason: why, request });
  });
}

export const paymentInput = z.object({
  amount: money("amount"),
  paidOn: z.iso.date("Enter the date it was received"),
  method: z.enum(["MOBILE_MONEY", "BANK_TRANSFER", "CASH", "OTHER"]),
  reference: optionalText(200),
  note: optionalText(500),
});

async function refreshPaid(tx: Tx, invoice: InvoiceRow) {
  const [row] = await tx
    .select({ total: sum(invoicePayments.amountMinor) })
    .from(invoicePayments)
    .where(and(eq(invoicePayments.invoiceId, invoice.id), isNull(invoicePayments.voidedAt)));
  const paid = Number(row?.total ?? 0);
  const fully = paid >= invoice.totalMinor && invoice.totalMinor > 0;
  await tx
    .update(invoices)
    .set({ paidMinor: paid, paidAt: fully ? (invoice.paidAt ?? new Date()) : null, version: invoice.version + 1 })
    .where(eq(invoices.id, invoice.id))
    .catch(rethrowDbGuard);
  return paid;
}

export async function recordInvoicePayment(actor: Actor, invoiceId: string, raw: z.input<typeof paymentInput>, request?: RequestMeta) {
  assertCan(actor, "invoice.recordPayment");
  const input = paymentInput.parse(raw);
  if (input.amount <= 0) throw new ServiceError("The amount must be more than zero.");
  if (input.paidOn > todayInOperatingZone()) throw new ServiceError("The payment date cannot be in the future.");
  await withActor(actor, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    if (invoice.status !== "ISSUED") throw new ServiceError("Payments are recorded on issued invoices only.");
    const balance = invoice.totalMinor - invoice.paidMinor;
    if (input.amount > balance) throw new ServiceError(`That is more than the ${formatMoney(balance, invoice.currency)} still owed.`);
    const [payment] = await tx
      .insert(invoicePayments)
      .values({ invoiceId, amountMinor: input.amount, paidOn: input.paidOn, method: input.method, reference: input.reference ?? null, note: input.note ?? null, recordedBy: actor.id })
      .returning()
      .catch(rethrowDbGuard);
    await refreshPaid(tx, invoice);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "invoice",
      entityId: invoiceId,
      action: "invoice.payment_recorded",
      after: { paymentId: payment.id, amountMinor: input.amount, paidOn: input.paidOn, method: input.method, reference: input.reference ?? null },
      request,
    });
  });
}

export async function voidInvoicePayment(actor: Actor, paymentId: string, raw: { reason: string }, request?: RequestMeta) {
  assertCan(actor, "invoice.recordPayment");
  const why = reason.parse(raw.reason);
  await withActor(actor, async (tx) => {
    const [payment] = await tx.select().from(invoicePayments).where(eq(invoicePayments.id, paymentId));
    if (!payment) throw new ServiceError("Payment not found.");
    if (payment.voidedAt) throw new ServiceError("This payment is already void.");
    const invoice = await lockInvoice(tx, payment.invoiceId);
    await tx
      .update(invoicePayments)
      .set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: why })
      .where(eq(invoicePayments.id, paymentId))
      .catch(rethrowDbGuard);
    await refreshPaid(tx, invoice);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "invoice",
      entityId: invoice.id,
      action: "invoice.payment_voided",
      before: { paymentId, amountMinor: payment.amountMinor },
      reason: why,
      request,
    });
  });
}

/** Records that the invoice was emailed (the email itself is sent by the caller). */
export async function markInvoiceSent(actor: Actor, invoiceId: string, to: string, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  await withActor(actor, async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    await tx.update(invoices).set({ sentAt: new Date(), sentTo: to, version: invoice.version + 1 }).where(eq(invoices.id, invoiceId));
    await recordAudit(tx, { actorId: actor.id, entityType: "invoice", entityId: invoiceId, action: "invoice.sent", after: { to }, request });
  });
}

// ---------------------------------------------------------------------------------------------
// Subscriptions → invoices

/** A new draft for the subscription's customer with its next period. Returns the draft. */
export async function invoiceSubscription(actor: Actor, subscriptionId: string, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  return withActor(actor, async (tx) => {
    const [sub] = await tx.select({ customerId: subscriptions.customerId }).from(subscriptions).where(eq(subscriptions.id, subscriptionId));
    if (!sub) throw new ServiceError("Subscription not found.");
    const draft = await createDraftTx(tx, actor, sub.customerId, null, request);
    await addSubscriptionPeriodTx(tx, actor, draft, subscriptionId, request);
    await refreshTotal(tx, draft);
    return draft;
  });
}

/**
 * Drafts for every active subscription whose next period starts by `through` (default: in 7 days),
 * one draft per customer, ready to check and issue. Periods already billed are skipped.
 */
export async function prepareSubscriptionInvoices(actor: Actor, options: { through?: string } = {}, request?: RequestMeta) {
  assertCan(actor, "invoice.manage");
  const through = options.through ?? addDays(todayInOperatingZone(), 7);
  return withActor(actor, async (tx) => {
    const active = await tx
      .select({ s: subscriptions, customerStatus: customers.status })
      .from(subscriptions)
      .innerJoin(customers, eq(customers.id, subscriptions.customerId))
      .where(and(eq(subscriptions.status, "ACTIVE"), ne(customers.status, "ARCHIVED")))
      .orderBy(asc(customers.name));
    const drafts = new Map<string, InvoiceRow>();
    let lines = 0;
    for (const { s } of active) {
      const period = nextBillingPeriod({ ...s, lastPeriodEnd: await lastBilledPeriodEnd(tx, s.id) });
      if (!period || period.start > through) continue;
      let draft = drafts.get(s.customerId);
      if (!draft) {
        draft = await createDraftTx(tx, actor, s.customerId, null, request);
        drafts.set(s.customerId, draft);
      }
      await addSubscriptionPeriodTx(tx, actor, draft, s.id, request);
      lines += 1;
    }
    for (const draft of drafts.values()) await refreshTotal(tx, draft);
    return { drafts: drafts.size, lines, through };
  });
}

// ---------------------------------------------------------------------------------------------
// Reading

export const invoiceFilters = z.object({
  q: z.string().trim().max(100).optional(),
  state: z.enum(["DRAFT", "OPEN", "PARTLY_PAID", "PAID", "OVERDUE", "VOID", "UNPAID"]).optional().catch(undefined),
  customerId: z.uuid().optional(),
});

export type InvoiceSummary = {
  id: string;
  number: string | null;
  customerId: string;
  customerName: string;
  status: InvoiceRow["status"];
  state: InvoiceState;
  issueDate: string | null;
  dueDate: string | null;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  currency: string;
  sentAt: Date | null;
  createdAt: Date;
};

export async function listInvoices(actor: Actor, raw: z.input<typeof invoiceFilters> = {}): Promise<InvoiceSummary[]> {
  assertCan(actor, "invoice.view");
  const filters = invoiceFilters.parse(raw);
  const today = todayInOperatingZone();
  return withActor(actor, async (tx) => {
    const conditions = [];
    if (filters.customerId) conditions.push(eq(invoices.customerId, filters.customerId));
    if (filters.q) {
      const like = `%${filters.q.replace(/[%_\\]/g, "\\$&")}%`;
      conditions.push(or(ilike(invoices.number, like), ilike(customers.name, like)));
    }
    const rows = await tx
      .select({ i: invoices, customerName: customers.name })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(invoices.createdAt));
    const out = rows.map(({ i, customerName }) => ({
      id: i.id,
      number: i.number,
      customerId: i.customerId,
      customerName,
      status: i.status,
      state: invoiceState(i, today),
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      totalMinor: i.totalMinor,
      paidMinor: i.paidMinor,
      balanceMinor: balanceMinor(i),
      currency: i.currency,
      sentAt: i.sentAt,
      createdAt: i.createdAt,
    }));
    if (!filters.state) return out;
    if (filters.state === "UNPAID") return out.filter((i) => i.balanceMinor > 0);
    return out.filter((i) => i.state === filters.state);
  });
}

/** Headline numbers for the Invoices page. */
export function invoiceTotals(rows: InvoiceSummary[], today: string) {
  const month = today.slice(0, 7);
  return {
    outstandingMinor: rows.reduce((n, i) => n + i.balanceMinor, 0),
    overdueMinor: rows.filter((i) => i.state === "OVERDUE").reduce((n, i) => n + i.balanceMinor, 0),
    overdueCount: rows.filter((i) => i.state === "OVERDUE").length,
    drafts: rows.filter((i) => i.state === "DRAFT").length,
    issuedThisMonthMinor: rows.filter((i) => i.status === "ISSUED" && i.issueDate?.startsWith(month)).reduce((n, i) => n + i.totalMinor, 0),
  };
}

export async function getInvoice(actor: Actor, invoiceId: string) {
  assertCan(actor, "invoice.view");
  if (!z.uuid().safeParse(invoiceId).success) return null;
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ i: invoices, customerName: customers.name, customerOwnerId: customers.ownerId })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(eq(invoices.id, invoiceId));
    if (!row) return null;
    const lines = await tx
      .select({ line: invoiceLines, projectCode: projects.code })
      .from(invoiceLines)
      .leftJoin(projects, eq(projects.id, invoiceLines.projectId))
      .where(eq(invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLines.position));
    const payments = await tx
      .select({ p: invoicePayments, recordedByName: users.name })
      .from(invoicePayments)
      .innerJoin(users, eq(users.id, invoicePayments.recordedBy))
      .where(eq(invoicePayments.invoiceId, invoiceId))
      .orderBy(asc(invoicePayments.createdAt));
    const activity = await tx
      .select({ event: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(and(eq(auditEvents.entityType, "invoice"), eq(auditEvents.entityId, invoiceId)))
      .orderBy(desc(auditEvents.createdAt))
      .limit(50);
    const [settings] = await tx.select().from(invoiceSettings);
    const today = todayInOperatingZone();
    const contact = row.i.status === "DRAFT" ? await billingContact(tx, row.i.customerId) : null;
    return {
      invoice: row.i,
      customerName: row.customerName,
      state: invoiceState(row.i, today),
      balanceMinor: balanceMinor(row.i),
      lines: lines.map((l) => ({ ...l.line, projectCode: l.projectCode })),
      payments: payments.map((p) => ({ ...p.p, recordedByName: p.recordedByName })),
      activity: activity.map((a) => ({ ...a.event, actorName: a.actorName })),
      settings: settings ?? null,
      /** For drafts: who it would be addressed to if issued now. */
      draftBillTo: contact,
      defaultDueDate: addDays(today, settings?.defaultDueDays ?? 14),
    };
  });
}

/** For the draft's "add" forms: the customer's active subscriptions and open projects. */
export async function invoiceSources(actor: Actor, customerId: string) {
  assertCan(actor, "invoice.view");
  return withActor(actor, async (tx) => {
    const subs = await tx
      .select({ id: subscriptions.id, serviceName: subscriptions.serviceName, startDate: subscriptions.startDate, endDate: subscriptions.endDate, billingCadence: subscriptions.billingCadence })
      .from(subscriptions)
      .where(and(eq(subscriptions.customerId, customerId), eq(subscriptions.status, "ACTIVE")))
      .orderBy(asc(subscriptions.serviceName));
    const subsWithNext = [];
    for (const s of subs) subsWithNext.push({ ...s, next: nextBillingPeriod({ ...s, lastPeriodEnd: await lastBilledPeriodEnd(tx, s.id) }) });
    const projectRows = await tx
      .select({ id: projects.id, code: projects.code, name: projects.name, totalValueMinor: projects.totalValueMinor })
      .from(projects)
      .where(and(eq(projects.customerId, customerId), ne(projects.status, "CANCELLED")))
      .orderBy(desc(projects.createdAt));
    const projectsWithBilled = [];
    for (const p of projectRows) projectsWithBilled.push({ ...p, billedMinor: await projectBilledMinor(tx, p.id) });
    return { subscriptions: subsWithNext, projects: projectsWithBilled };
  });
}

/** The amount already invoiced per project (not void), for the project page. */
export async function projectInvoicing(actor: Actor, projectId: string) {
  if (!can(actor, "invoice.view")) return null;
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({ id: invoices.id, number: invoices.number, status: invoices.status, amountMinor: invoiceLines.amountMinor })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(eq(invoiceLines.projectId, projectId), ne(invoices.status, "VOID")));
    return { billedMinor: rows.reduce((n, r) => n + r.amountMinor, 0), invoices: rows };
  });
}

// ---------------------------------------------------------------------------------------------
// Settings

export const settingsInput = z.object({
  businessName: z.string().trim().min(2, "Enter the business name").max(200),
  address: optionalText(1000),
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email("Enter a valid email").nullable())
    .nullish(),
  phone: optionalText(60),
  taxId: optionalText(60),
  paymentInstructions: optionalText(2000),
  footer: optionalText(500),
  defaultDueDays: z.coerce.number().int().min(0, "0 to 120 days").max(120, "0 to 120 days"),
});

export async function getInvoiceSettings(actor: Actor) {
  // Phase 28: whoever may change the settings may also read them.
  if (!can(actor, "invoice.settings")) assertCan(actor, "invoice.view");
  return withActor(actor, async (tx) => (await tx.select().from(invoiceSettings))[0] ?? null);
}

export async function updateInvoiceSettings(actor: Actor, raw: z.input<typeof settingsInput>, request?: RequestMeta) {
  assertCan(actor, "invoice.settings");
  const input = settingsInput.parse(raw);
  await withActor(actor, async (tx) => {
    const values = {
      ...input,
      address: input.address ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      taxId: input.taxId ?? null,
      paymentInstructions: input.paymentInstructions ?? null,
      footer: input.footer ?? null,
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    await tx.insert(invoiceSettings).values({ organizationId: actor.orgId, ...values }).onConflictDoUpdate({ target: invoiceSettings.organizationId, set: values });
    await recordAudit(tx, { actorId: actor.id, entityType: "invoice_settings", entityId: actor.id, action: "invoice.settings_updated", after: values, request });
  });
}

// ---------------------------------------------------------------------------------------------
// Overdue reminders

/** Creates the overdue-invoice reminders the signed-in manager is missing (each sent once). */
export async function refreshInvoiceAlerts(actor: Actor): Promise<number> {
  if (!can(actor, "invoice.view")) return 0;
  const today = todayInOperatingZone();
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({ i: invoices, customerName: customers.name, ownerId: customers.ownerId })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(and(eq(invoices.status, "ISSUED"), sql`${invoices.paidMinor} < ${invoices.totalMinor}`, sql`${invoices.dueDate} < ${today}`));
    const alerts = invoiceAlerts(
      actor.id,
      actor.role === "ADMIN",
      rows.map(({ i, customerName, ownerId }) => ({
        id: i.id,
        number: i.number ?? "",
        customerName,
        ownerId,
        dueDate: i.dueDate ?? today,
        balanceMinor: balanceMinor(i),
        balance: formatMoney(balanceMinor(i), i.currency),
      })),
      today,
    );
    if (alerts.length === 0) return 0;
    const inserted = await tx
      .insert(notifications)
      .values(alerts.map((a) => ({ recipientId: a.recipientId, type: a.type, title: a.title, message: a.message, entityType: "invoice", entityId: a.invoiceId, dedupeKey: a.dedupeKey })))
      .onConflictDoNothing({ target: [notifications.recipientId, notifications.dedupeKey], where: sql`${notifications.dedupeKey} IS NOT NULL` })
      .returning({ id: notifications.id });
    return inserted.length;
  });
}

export async function refreshInvoiceAlertsQuietly(actor: Actor): Promise<void> {
  try {
    await refreshInvoiceAlerts(actor);
  } catch (error) {
    console.error("Invoice alerts failed", error instanceof Error ? error.message : error);
  }
}


