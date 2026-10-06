import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, billingStages, invoices, payoutLedgerEntries, projects } from "@/lib/db/schema";
import { type Actor, PermissionError } from "@/lib/permissions";
import { approveProject, requestApproval } from "@/modules/approvals";
import {
  addStage,
  applyPreset,
  createChangeRequest,
  decideChangeRequest,
  getBilling,
  invoiceStage,
  markChangeRequestSent,
  recordSignOff,
  removeStage,
  sendForReview,
  updateMoneyFlowSettings,
} from "@/modules/billing";
import { issueInvoice, recordInvoicePayment, voidInvoice } from "@/modules/invoices";
import { recordPayment } from "@/modules/payments";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { createCompany, createUser, db, expectDbError } from "./fixtures";

// Phase 29: payment plans, the deposit rule, client sign-off, change requests, and paying the team
// in step with the client.

const today = new Date().toISOString().slice(0, 10);

async function company() {
  const { owner } = await createCompany();
  const pm = await createUser("PROJECT_MANAGER", { orgId: owner.orgId });
  const dev = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
  return { owner, pm, dev };
}

/** A GHS 10,000 client project in planning; the developer gets 70%, the company keeps 30%. */
async function clientProject(pm: Actor, dev: Actor) {
  const project = await createProject(pm, {
    name: `Shop ${crypto.randomUUID().slice(0, 6)}`,
    clientType: "EXTERNAL",
    clientName: `Kofi Stores ${crypto.randomUUID().slice(0, 4)}`,
    totalValue: "10000",
    splitMode: "PERCENTAGE",
    agodShare: "30",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: dev.id, roleOnProject: "Developer", split: "70" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  return project;
}

const projectRow = async (id: string) => (await db.select().from(projects).where(eq(projects.id, id)))[0];

async function issueAndPay(owner: Actor, invoiceId: string, amount: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  await issueInvoice(owner, invoiceId, { issueDate: today, dueDate: today, version: inv.version });
  if (amount !== "0") await recordInvoicePayment(owner, invoiceId, { amount, paidOn: today, method: "MOBILE_MONEY" });
}

describe("payment plan", () => {
  it("a 50/50 plan uses the company's usual deposit; stages can't exceed the project's value", async () => {
    const { owner, pm, dev } = await company();
    await updateMoneyFlowSettings(owner, { defaultDeposit: "40", requireDeposit: false, clientReviewDays: 10, payoutRelease: "ON_APPROVAL" });
    const project = await clientProject(pm, dev);
    await applyPreset(pm, project.id, "HALF");
    let billing = (await getBilling(pm, project.id))!;
    expect(billing.stages.map((s) => [s.kind, s.amountMinor])).toEqual([
      ["DEPOSIT", 400_000],
      ["FINAL", 600_000],
    ]);
    expect(billing.unplannedMinor).toBe(0);
    await expect(addStage(pm, project.id, { label: "Extra", kind: "MILESTONE", amount: "1.00" })).rejects.toThrow(/more than the project's value/);

    await applyPreset(pm, project.id, "THIRDS");
    billing = (await getBilling(pm, project.id))!;
    expect(billing.stages.map((s) => s.amountMinor)).toEqual([400_000, 300_000, 300_000]);
    await removeStage(pm, billing.stages[1].id);
    await addStage(pm, project.id, { label: "Design approved", kind: "MILESTONE", amount: "30%" });
    expect((await getBilling(pm, project.id))!.plannedMinor).toBe(1_000_000);
    // Team members never see the client's payment plan.
    expect(await getBilling(dev, project.id)).toBeNull();
  });

  it("each stage gets its own invoice; its status follows the invoice, and a void lets it be billed again", async () => {
    const { owner, pm, dev } = await company();
    const project = await clientProject(pm, dev);
    await applyPreset(pm, project.id, "HALF");
    const [deposit] = (await getBilling(pm, project.id))!.stages;
    const invoiceId = await invoiceStage(pm, deposit.id);
    await expect(invoiceStage(pm, deposit.id)).rejects.toThrow(/already on an invoice/);
    const stage = async () => (await getBilling(pm, project.id))!.stages[0];
    expect((await stage()).status).toBe("DRAFT");
    await issueAndPay(owner, invoiceId, "2000");
    expect(await stage()).toMatchObject({ status: "PART_PAID", paidMinor: 200_000 });
    await recordInvoicePayment(owner, invoiceId, { amount: "3000", paidOn: today, method: "BANK_TRANSFER" });
    expect((await stage()).status).toBe("PAID");
    expect((await getBilling(pm, project.id))!.clientPaidMinor).toBe(500_000);

    // A voided invoice frees the stage (here on a second stage, before any payment).
    const finalId = (await getBilling(pm, project.id))!.stages[1].id;
    const second = await invoiceStage(pm, finalId);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, second));
    await issueInvoice(owner, second, { issueDate: today, dueDate: today, version: inv.version });
    await voidInvoice(owner, second, { reason: "Wrong amount" });
    expect((await getBilling(pm, project.id))!.stages[1].status).toBe("NOT_INVOICED");
    await invoiceStage(pm, finalId);
    // An invoiced stage can't be deleted (the database refuses it too).
    await expect(removeStage(pm, deposit.id)).rejects.toThrow(/invoiced/);
    await expectDbError(withActor(pm, (tx) => tx.delete(billingStages).where(eq(billingStages.id, deposit.id))), /invoiced/);
  });
});

describe("no deposit, no work", () => {
  it("with the setting on, a client project starts only once the deposit is paid, or with a reason", async () => {
    const { owner, pm, dev } = await company();
    await updateMoneyFlowSettings(owner, { defaultDeposit: "50", requireDeposit: true, clientReviewDays: 10, payoutRelease: "ON_APPROVAL" });
    const project = await clientProject(pm, dev);
    await expect(changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" })).rejects.toThrow(/no deposit/);
    await applyPreset(pm, project.id, "HALF");
    await expect(changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" })).rejects.toThrow(/deposit \(GHS 5,000.00\) isn't paid yet/);
    const invoiceId = await invoiceStage(pm, (await getBilling(pm, project.id))!.stages[0].id);
    await issueAndPay(owner, invoiceId, "5000");
    await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
    expect((await projectRow(project.id)).status).toBe("IN_PROGRESS");
  });

  it("a manager can start anyway with a reason, which is recorded", async () => {
    const { owner, pm, dev } = await company();
    await updateMoneyFlowSettings(owner, { defaultDeposit: "50", requireDeposit: true, clientReviewDays: 10, payoutRelease: "ON_APPROVAL" });
    const project = await clientProject(pm, dev);
    await applyPreset(pm, project.id, "HALF");
    await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS", reason: "Long-standing client, pays on Friday" });
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, project.id));
    const started = events.find((e) => e.action === "project.status_changed" && (e.afterJson as { status: string }).status === "IN_PROGRESS")!;
    expect(started.afterJson).toMatchObject({ startedWithoutDeposit: true });
    expect(started.reason).toBe("Long-standing client, pays on Friday");
  });
});

describe("client sign-off", () => {
  it("records when work went for review, the deadline in working days, and how the client accepted", async () => {
    const { owner, pm, dev } = await company();
    await updateMoneyFlowSettings(owner, { defaultDeposit: "50", requireDeposit: false, clientReviewDays: 5, payoutRelease: "ON_APPROVAL" });
    const project = await clientProject(pm, dev);
    await applyPreset(pm, project.id, "HALF");
    const final = (await getBilling(pm, project.id))!.stages[1];
    await sendForReview(pm, final.id, { on: "2026-10-02" }); // a Friday
    expect((await getBilling(pm, project.id))!.stages[1].reviewDueOn).toBe("2026-10-09");
    await expect(recordSignOff(pm, final.id, { on: today, note: "ok" })).rejects.toThrow();
    await recordSignOff(pm, final.id, { on: "2026-10-05", note: "Email from Kofi: all good" });
    const signed = (await getBilling(pm, project.id))!.stages[1];
    expect(signed).toMatchObject({ signedOffOn: "2026-10-05", signOffNote: "Email from Kofi: all good", reviewDueOn: null });
    await expect(recordSignOff(pm, final.id, { on: today, note: "Again please" })).rejects.toThrow(/already signed/);
    await expect(sendForReview(dev, final.id, { on: today })).rejects.toThrow(PermissionError);
  });
});

describe("change requests", () => {
  it("an approved change adds to the value, the plan and the team's percentage pool", async () => {
    const { pm, dev } = await company();
    const project = await clientProject(pm, dev);
    await applyPreset(pm, project.id, "HALF");
    await createChangeRequest(pm, project.id, { title: "Add MoMo checkout", amount: "2000", extraDays: 7 });
    let cr = (await getBilling(pm, project.id))!.changes[0];
    await markChangeRequestSent(pm, cr.id);
    await decideChangeRequest(pm, cr.id, { approve: true, on: today, note: "Approved on WhatsApp by Kofi" });
    const billing = (await getBilling(pm, project.id))!;
    expect(billing.project.totalValueMinor).toBe(1_200_000);
    expect(billing.stages.at(-1)).toMatchObject({ kind: "CHANGE", amountMinor: 200_000, label: "Change: Add MoMo checkout" });
    expect(billing.unplannedMinor).toBe(0);
    cr = billing.changes[0];
    expect(cr.status).toBe("APPROVED");
    await expect(decideChangeRequest(pm, cr.id, { approve: false, on: today, note: "Changed mind" })).rejects.toThrow(/already been decided/);
    // A decided change request never changes, even directly in the database.
    await expectDbError(withActor(pm, (tx) => tx.execute(`update change_requests set amount_minor = 1 where id = '${cr.id}'`)), /decided/);
    // Presets keep the change payment.
    await applyPreset(pm, project.id, "HALF");
    expect((await getBilling(pm, project.id))!.stages.map((s) => s.amountMinor)).toEqual([200_000, 500_000, 500_000]);
  });

  it("a rejected change leaves the project as it was", async () => {
    const { pm, dev } = await company();
    const project = await clientProject(pm, dev);
    await createChangeRequest(pm, project.id, { title: "Dark mode", amount: "800", extraDays: 0 });
    const cr = (await getBilling(pm, project.id))!.changes[0];
    await decideChangeRequest(pm, cr.id, { approve: false, on: today, note: "Client said not now" });
    expect((await projectRow(project.id)).totalValueMinor).toBe(1_000_000);
  });
});

describe("paying the team in step with the client", () => {
  it("only the share the client has paid can be paid out, in the app and in the database", async () => {
    const { owner, pm, dev } = await company();
    await updateMoneyFlowSettings(owner, { defaultDeposit: "50", requireDeposit: false, clientReviewDays: 10, payoutRelease: "ON_CLIENT_PAYMENT" });
    const project = await clientProject(pm, dev);
    await applyPreset(pm, project.id, "HALF");
    const [deposit, final] = (await getBilling(pm, project.id))!.stages;
    const depositInvoice = await invoiceStage(pm, deposit.id);
    await issueAndPay(owner, depositInvoice, "5000");
    await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
    await requestApproval(dev, project.id);
    const version = (await projectRow(project.id)).version;
    await approveProject(pm, project.id, { expectedVersion: version });
    const [entry] = await withActor(owner, (tx) => tx.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id)));
    expect(entry.amountOwedMinor).toBe(700_000);

    // The client has paid half, so half of the GHS 7,000 payout can be paid.
    await expect(recordPayment(owner, entry.id, { amount: "3500.01", method: "MOBILE_MONEY", paidOn: today })).rejects.toThrow(/Only GHS 3,500.00 .* can be paid now/);
    await recordPayment(owner, entry.id, { amount: "3500", method: "MOBILE_MONEY", paidOn: today });
    await expectDbError(
      withActor(owner, (tx) =>
        tx.execute(`insert into payment_transactions (ledger_entry_id, amount_minor, currency, method, paid_at, recorded_by)
                    values ('${entry.id}', 1, 'GHS', 'MOBILE_MONEY', now(), '${owner.id}')`),
      ),
      /until the client pays more/,
    );
    // The client pays the rest; the rest of the payout is released.
    const finalInvoice = await invoiceStage(pm, final.id);
    await issueAndPay(owner, finalInvoice, "5000");
    await recordPayment(owner, entry.id, { amount: "3500", method: "MOBILE_MONEY", paidOn: today });
  });

  it("with payouts on approval (the default), the client's payments don't matter", async () => {
    const { owner, pm, dev } = await company();
    const project = await clientProject(pm, dev);
    await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
    await requestApproval(dev, project.id);
    await approveProject(pm, project.id, { expectedVersion: (await projectRow(project.id)).version });
    const [entry] = await withActor(owner, (tx) => tx.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id)));
    await recordPayment(owner, entry.id, { amount: "7000", method: "MOBILE_MONEY", paidOn: today });
  });

  it("only people with company settings change these settings", async () => {
    const { pm } = await company();
    await expect(updateMoneyFlowSettings(pm, { defaultDeposit: "50", requireDeposit: true, clientReviewDays: 10, payoutRelease: "ON_APPROVAL" })).rejects.toThrow(PermissionError);
  });
});
