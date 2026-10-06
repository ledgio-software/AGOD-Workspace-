import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { invoiceLines, invoicePayments, invoices } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import { addContact, createCustomer } from "@/modules/customers";
import {
  addInvoiceLine,
  addSubscriptionPeriod,
  createDraftInvoice,
  deleteDraftInvoice,
  getInvoice,
  invoiceSources,
  invoiceTotals,
  issueInvoice,
  listInvoices,
  prepareSubscriptionInvoices,
  recordInvoicePayment,
  refreshInvoiceAlerts,
  removeInvoiceLine,
  updateInvoiceSettings,
  voidInvoice,
  voidInvoicePayment,
} from "@/modules/invoices";
import { createProject } from "@/modules/projects";
import { createService, createSubscription } from "@/modules/subscriptions";
import { createUser, db, expectDbError } from "./fixtures";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const admin = await createUser("ADMIN");
  const pm = await createUser("PROJECT_MANAGER");
  const customer = await createCustomer(pm, { name: `Invoiced ${randomUUID().slice(0, 8)}`, type: "COMPANY", status: "ACTIVE", ownerId: pm.id });
  return { admin, pm, customer };
}

async function draftWithLine(pm: Awaited<ReturnType<typeof setup>>["pm"], customerId: string, price = "100.00", quantity = 2) {
  const draft = await createDraftInvoice(pm, { customerId });
  await addInvoiceLine(pm, draft.id, { description: "Setup and training", quantity, unitPrice: price });
  return draft;
}

async function issue(pm: Awaited<ReturnType<typeof setup>>["pm"], invoiceId: string, dueOffset = 14) {
  const current = (await db.select().from(invoices).where(eq(invoices.id, invoiceId)))[0];
  return issueInvoice(pm, invoiceId, { issueDate: day(0), dueDate: day(dueOffset), version: current.version });
}

describe("invoice drafts", () => {
  it("totals lines, validates, and members cannot see invoices", async () => {
    const { pm, customer } = await setup();
    const member = await createUser("TEAM_MEMBER");
    const draft = await draftWithLine(pm, customer.id);
    await addInvoiceLine(pm, draft.id, { description: "Hosting setup", quantity: 1, unitPrice: "50" });
    const detail = await getInvoice(pm, draft.id);
    expect(detail?.invoice.totalMinor).toBe(25_000);
    expect(detail?.lines.map((l) => l.amountMinor)).toEqual([20_000, 5_000]);
    await expect(addInvoiceLine(pm, draft.id, { description: "x", quantity: 1, unitPrice: "1" })).rejects.toThrow(/Describe/);
    await expect(addInvoiceLine(pm, draft.id, { description: "Bad price", quantity: 1, unitPrice: "1.234" })).rejects.toThrow(/GHS/);
    await expect(listInvoices(member)).rejects.toThrow(PermissionError);
    expect(await withActor(member, (tx) => tx.select().from(invoices))).toHaveLength(0);

    await removeInvoiceLine(pm, detail!.lines[1].id);
    expect((await getInvoice(pm, draft.id))?.invoice.totalMinor).toBe(20_000);
    await deleteDraftInvoice(pm, draft.id);
    expect(await getInvoice(pm, draft.id)).toBeNull();
  });
});

describe("issuing", () => {
  it("numbers invoices in sequence, freezes them, and copies the billing contact", async () => {
    const { pm, customer } = await setup();
    await addContact(pm, customer.id, { name: "Abena Owusu", email: "abena@example.com", preferredChannel: "EMAIL", isBilling: true });
    const empty = await createDraftInvoice(pm, { customerId: customer.id });
    await expect(issueInvoice(pm, empty.id, { issueDate: day(0), dueDate: day(14), version: empty.version })).rejects.toThrow(/at least one line/);

    const a = await issue(pm, (await draftWithLine(pm, customer.id)).id);
    const b = await issue(pm, (await draftWithLine(pm, customer.id)).id);
    expect(a.number).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(Number(b.number!.slice(-4))).toBe(Number(a.number!.slice(-4)) + 1);
    expect(a.billToEmail).toBe("abena@example.com");
    expect(a.billToName).toContain("attn. Abena Owusu");
    await expect(issueInvoice(pm, a.id, { issueDate: day(0), dueDate: day(14), version: a.version })).rejects.toThrow(/draft/);

    // Frozen: lines and terms can't change, even bypassing the service.
    await expect(addInvoiceLine(pm, a.id, { description: "Late extra", quantity: 1, unitPrice: "5" })).rejects.toThrow(/draft/);
    await expectDbError(db.insert(invoiceLines).values({ invoiceId: a.id, position: 9, description: "Sneaky", quantity: 1, unitPriceMinor: 1, amountMinor: 1 }), /cannot be changed/);
    await expectDbError(db.update(invoices).set({ totalMinor: 1 }).where(eq(invoices.id, a.id)), /cannot be edited/);
    await expectDbError(db.delete(invoices).where(eq(invoices.id, a.id)), /cannot be deleted/);
    await expect(issueInvoice(pm, b.id, { issueDate: day(5), dueDate: day(1), version: b.version })).rejects.toThrow();
  });
});

describe("payments", () => {
  it("only Admins record payments; partial then full payment; voiding a payment reopens the invoice", async () => {
    const { admin, pm, customer } = await setup();
    const inv = await issue(pm, (await draftWithLine(pm, customer.id)).id); // GHS 200.00
    const pay = { method: "MOBILE_MONEY" as const, paidOn: day(0), reference: "MOMO-1" };
    await expect(recordInvoicePayment(pm, inv.id, { ...pay, amount: "50" })).rejects.toThrow(PermissionError);
    await expect(recordInvoicePayment(admin, inv.id, { ...pay, amount: "250" })).rejects.toThrow(/more than/);
    await expect(recordInvoicePayment(admin, inv.id, { ...pay, amount: "50", paidOn: day(3) })).rejects.toThrow(/future/);

    await recordInvoicePayment(admin, inv.id, { ...pay, amount: "50" });
    let detail = await getInvoice(pm, inv.id);
    expect(detail?.state).toBe("PARTLY_PAID");
    expect(detail?.balanceMinor).toBe(15_000);
    await recordInvoicePayment(admin, inv.id, { ...pay, amount: "150", reference: "MOMO-2" });
    detail = await getInvoice(pm, inv.id);
    expect(detail?.state).toBe("PAID");
    expect(detail?.invoice.paidAt).not.toBeNull();

    await expect(voidInvoice(pm, inv.id, { reason: "Wrong customer" })).rejects.toThrow(/has payments/);
    const second = detail!.payments[1];
    await expect(voidInvoicePayment(pm, second.id, { reason: "Bounced" })).rejects.toThrow(PermissionError);
    await voidInvoicePayment(admin, second.id, { reason: "Transfer bounced" });
    detail = await getInvoice(pm, inv.id);
    expect(detail?.state).toBe("PARTLY_PAID");
    expect(detail?.invoice.paidAt).toBeNull();
    // Payments can't be deleted or edited directly.
    await expectDbError(db.delete(invoicePayments).where(eq(invoicePayments.id, second.id)), /cannot be deleted/);
    await expectDbError(db.update(invoicePayments).set({ amountMinor: 1 }).where(eq(invoicePayments.id, detail!.payments[0].id)), /voided once/);
  });

  it("voiding an unpaid invoice frees what it billed", async () => {
    const { pm, customer } = await setup();
    const service = await createService(pm, { code: `V-${randomUUID().slice(0, 6)}`, name: "Hosting", defaultCadence: "MONTHLY" });
    const sub = await createSubscription(pm, { customerId: customer.id, serviceId: service.id, startDate: day(-5), ownerId: pm.id, activate: true, billingCadence: "MONTHLY", price: "300", pricingBasis: "FIXED", quantity: 1, noticePeriodDays: 30 });
    const draft = await createDraftInvoice(pm, { customerId: customer.id });
    await addSubscriptionPeriod(pm, draft.id, sub.id);
    const inv = await issue(pm, draft.id);
    // The period is taken; a second draft can't bill it again, but it bills the *next* one.
    const next = await createDraftInvoice(pm, { customerId: customer.id });
    await addSubscriptionPeriod(pm, next.id, sub.id);
    expect((await getInvoice(pm, next.id))?.lines[0].periodStart).not.toBe((await getInvoice(pm, inv.id))?.lines[0].periodStart);
    await voidInvoice(pm, inv.id, { reason: "Issued by mistake" });
    await expect(voidInvoice(pm, inv.id, { reason: "Again" })).rejects.toThrow(/already void/);
    await expectDbError(db.update(invoices).set({ notes: "x" }).where(eq(invoices.id, inv.id)), /void invoice cannot be changed/);
  });
});

describe("billing subscriptions and projects", () => {
  it("bills periods one after another, rejects other customers and totals", async () => {
    const { pm, customer } = await setup();
    const other = await createCustomer(pm, { name: `Other ${randomUUID().slice(0, 8)}`, type: "COMPANY", status: "ACTIVE", ownerId: pm.id });
    const service = await createService(pm, { code: `B-${randomUUID().slice(0, 6)}`, name: "Support", defaultCadence: "MONTHLY" });
    const mk = (customerId: string, overrides = {}) =>
      createSubscription(pm, { customerId, serviceId: service.id, startDate: "2026-01-15", ownerId: pm.id, activate: true, billingCadence: "MONTHLY", price: "300", pricingBasis: "FIXED", quantity: 2, noticePeriodDays: 30, ...overrides });
    const sub = await mk(customer.id);

    const first = await createDraftInvoice(pm, { customerId: customer.id });
    await addSubscriptionPeriod(pm, first.id, sub.id);
    const second = await createDraftInvoice(pm, { customerId: customer.id });
    await addSubscriptionPeriod(pm, second.id, sub.id);
    const periods = [first, second].map(async (d) => (await getInvoice(pm, d.id))!.lines[0]);
    const [p1, p2] = await Promise.all(periods);
    expect([p1.periodStart, p1.periodEnd]).toEqual(["2026-01-15", "2026-02-14"]);
    expect([p2.periodStart, p2.periodEnd]).toEqual(["2026-02-15", "2026-03-14"]);
    expect(p1.amountMinor).toBe(60_000); // 2 × GHS 300.00
    expect((await invoiceSources(pm, customer.id)).subscriptions[0].next?.start).toBe("2026-03-15");

    const foreign = await mk(other.id);
    await expect(addSubscriptionPeriod(pm, first.id, foreign.id)).rejects.toThrow(/another customer/);
    const paused = await createDraftInvoice(pm, { customerId: customer.id });
    const custom = await mk(customer.id, { billingCadence: "CUSTOM" });
    await expect(addSubscriptionPeriod(pm, paused.id, custom.id)).rejects.toThrow(/custom billing/);

    const all = await listInvoices(pm, { customerId: customer.id });
    const totals = invoiceTotals(all, day(0));
    expect(totals.drafts).toBe(3);
  });

  it("prepares one draft per customer for the periods starting soon", async () => {
    const { pm, customer } = await setup();
    const service = await createService(pm, { code: `P-${randomUUID().slice(0, 6)}`, name: "Maintenance", defaultCadence: "MONTHLY" });
    const mk = () => createSubscription(pm, { customerId: customer.id, serviceId: service.id, startDate: day(2), ownerId: pm.id, activate: true, billingCadence: "MONTHLY", price: "100", pricingBasis: "FIXED", quantity: 1, noticePeriodDays: 30 });
    await mk();
    await mk();
    const result = await prepareSubscriptionInvoices(pm, { through: day(7) });
    expect(result.drafts).toBeGreaterThanOrEqual(1);
    const mine = await listInvoices(pm, { customerId: customer.id });
    expect(mine).toHaveLength(1);
    expect((await getInvoice(pm, mine[0].id))?.lines).toHaveLength(2);
    // Running it again finds nothing left to bill for that customer.
    await prepareSubscriptionInvoices(pm, { through: day(7) });
    expect(await listInvoices(pm, { customerId: customer.id })).toHaveLength(1);
  });

  it("project lines can't bill more than the project value or another customer's project", async () => {
    const { pm, customer } = await setup();
    const other = await createCustomer(pm, { name: `Other ${randomUUID().slice(0, 8)}`, type: "COMPANY", status: "ACTIVE", ownerId: pm.id });
    const mk = (customerId: string) => createProject(pm, { name: `Site ${randomUUID().slice(0, 6)}`, clientType: "EXTERNAL", customerId, totalValue: "1000", splitMode: "PERCENTAGE", projectOwnerId: pm.id });
    const project = await mk(customer.id);
    const theirs = await mk(other.id);
    const draft = await createDraftInvoice(pm, { customerId: customer.id });
    await addInvoiceLine(pm, draft.id, { description: "Deposit 60%", quantity: 1, unitPrice: "600", projectId: project.id });
    await expect(addInvoiceLine(pm, draft.id, { description: "Too much", quantity: 1, unitPrice: "500", projectId: project.id })).rejects.toThrow(/more than/);
    await expect(addInvoiceLine(pm, draft.id, { description: "Wrong client", quantity: 1, unitPrice: "10", projectId: theirs.id })).rejects.toThrow(/another customer/);
    await addInvoiceLine(pm, draft.id, { description: "Balance", quantity: 1, unitPrice: "400", projectId: project.id });
  });
});

describe("overdue reminders and settings", () => {
  it("reminds the account owner once per due date and only Admins edit the settings", async () => {
    const { admin, pm, customer } = await setup();
    const draft = await draftWithLine(pm, customer.id);
    const current = (await db.select().from(invoices).where(eq(invoices.id, draft.id)))[0];
    const inv = await issueInvoice(pm, draft.id, { issueDate: day(-20), dueDate: day(-3), version: current.version });
    expect(await refreshInvoiceAlerts(pm)).toBe(1);
    expect(await refreshInvoiceAlerts(pm)).toBe(0);
    expect(await refreshInvoiceAlerts(admin)).toBe(0); // only 3 days: not escalated yet
    expect((await getInvoice(pm, inv.id))?.state).toBe("OVERDUE");

    await expect(updateInvoiceSettings(pm, { businessName: "AGOD Ltd", defaultDueDays: 14 })).rejects.toThrow(PermissionError);
    await updateInvoiceSettings(admin, { businessName: "AGOD Ltd", address: "Accra", paymentInstructions: "MoMo 024 000 0000", defaultDueDays: 21 });
    expect((await getInvoice(pm, inv.id))?.settings?.paymentInstructions).toBe("MoMo 024 000 0000");
  });
});
