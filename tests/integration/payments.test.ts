import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, paymentTransactions, payoutLedgerEntries, projects } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import { approveProject, reopenProject, requestApproval } from "@/modules/approvals";
import { ServiceError } from "@/modules/errors";
import { listLedger } from "@/modules/ledger";
import { createAdjustment, getPayout, recordPayment } from "@/modules/payments";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { ledgerToCsv } from "@/modules/reports/csv";
import { getDashboard } from "@/modules/reports";
import { getMyWork } from "@/modules/work";
import { createUser, db, expectDbError } from "./fixtures";

const today = new Date().toISOString().slice(0, 10);

/** Approved project: member owed GHS 1,000.00 (one ledger entry). */
async function approved() {
  const pm = await createUser("PROJECT_MANAGER");
  const admin = await createUser("ADMIN");
  const member = await createUser("TEAM_MEMBER");
  const project = await createProject(pm, {
    name: `Pay ${crypto.randomUUID().slice(0, 6)}`,
    clientType: "INTERNAL",
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Dev", split: "100" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  await requestApproval(pm, project.id);
  const [{ version }] = await db.select({ version: projects.version }).from(projects).where(eq(projects.id, project.id));
  await approveProject(pm, project.id, { expectedVersion: version });
  const [entry] = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id));
  return { pm, admin, member, project, entry };
}

const pay = (amount: string, extra: Partial<{ reference: string; paidOn: string; method: "CASH" }> = {}) => ({
  amount,
  method: "MOBILE_MONEY" as const,
  paidOn: today,
  reference: "MOMO-001",
  ...extra,
});

describe("recording payments", () => {
  it("only Admins record payments (decision 4)", async () => {
    const { pm, member, entry } = await approved();
    await expect(recordPayment(pm, entry.id, pay("100"))).rejects.toThrow(PermissionError);
    await expect(recordPayment(member, entry.id, pay("100"))).rejects.toThrow(PermissionError);
  });

  it("a partial payment produces PARTIALLY_PAID, the final one PAID; balances update immediately", async () => {
    const { admin, member, entry } = await approved();
    const first = await recordPayment(admin, entry.id, pay("400.00"));
    expect(first.balance).toMatchObject({ status: "PARTIALLY_PAID", remainingMinor: 60_000 });
    expect((await getMyWork(member)).payouts.remainingMinor).toBe(60_000);

    const second = await recordPayment(admin, entry.id, pay("600", { reference: "MOMO-002" }));
    expect(second.balance).toMatchObject({ status: "PAID", remainingMinor: 0, paidMinor: 100_000 });
    const [row] = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.id, entry.id));
    expect(row.status).toBe("PAID");

    const work = await getMyWork(member);
    expect(work.unreadNotifications.filter((n) => n.type === "payment.recorded")).toHaveLength(2);
    const actions = (await db.select().from(auditEvents).where(eq(auditEvents.projectId, entry.projectId))).map((e) => e.action);
    expect(actions.filter((a) => a === "payment.recorded")).toHaveLength(2);
  });

  it("a payment cannot exceed the outstanding balance", async () => {
    const { admin, entry } = await approved();
    await recordPayment(admin, entry.id, pay("900"));
    await expect(recordPayment(admin, entry.id, pay("100.01"))).rejects.toThrow(/exceeds the outstanding balance/);
    await expect(recordPayment(admin, entry.id, pay("0"))).rejects.toThrow(/more than zero/);
    await expect(recordPayment(admin, entry.id, pay("10", { paidOn: "2999-01-01" }))).rejects.toThrow(/future/);
  });

  it("the database refuses overpayment and fake 'paid' statuses on its own", async () => {
    const { admin, entry } = await approved();
    await expectDbError(
      withActor(admin, (tx) =>
        tx.insert(paymentTransactions).values({
          ledgerEntryId: entry.id,
          amountMinor: 100_001,
          method: "CASH",
          paidAt: new Date(),
          recordedBy: admin.id,
        }),
      ),
      /exceeds the outstanding balance/,
    );
    await expectDbError(
      withActor(admin, (tx) => tx.update(payoutLedgerEntries).set({ status: "PAID" }).where(eq(payoutLedgerEntries.id, entry.id))),
      /derived from payments/,
    );
  });

  it("concurrent payments cannot overpay together", async () => {
    const { admin, entry } = await approved();
    const results = await Promise.allSettled([
      recordPayment(admin, entry.id, pay("700")),
      recordPayment(admin, entry.id, pay("700")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const paid = await db.select().from(paymentTransactions).where(eq(paymentTransactions.ledgerEntryId, entry.id));
    expect(paid.reduce((s, p) => s + p.amountMinor, 0)).toBe(70_000);
  });

  it("members can read only their own payout", async () => {
    const { admin, member, entry } = await approved();
    await recordPayment(admin, entry.id, pay("250"));
    expect((await getPayout(member, entry.id))?.payments).toHaveLength(1);
    const stranger = await createUser("TEAM_MEMBER");
    expect(await getPayout(stranger, entry.id)).toBeNull();
  });
});

describe("adjustments", () => {
  it("only Admins adjust; a reason is required", async () => {
    const { pm, admin, entry } = await approved();
    await expect(createAdjustment(pm, entry.id, { type: "INCREASE", amount: "50", reason: "Bonus" })).rejects.toThrow(
      PermissionError,
    );
    await expect(createAdjustment(admin, entry.id, { type: "INCREASE", amount: "50", reason: "" })).rejects.toThrow();
  });

  it("an increase allows paying more without changing the original amount", async () => {
    const { admin, entry } = await approved();
    await recordPayment(admin, entry.id, pay("1000"));
    await expect(recordPayment(admin, entry.id, pay("50"))).rejects.toThrow(/exceeds/);
    const { balance } = await createAdjustment(admin, entry.id, { type: "INCREASE", amount: "50", reason: "Extra weekend work" });
    expect(balance).toMatchObject({ status: "PARTIALLY_PAID", originalMinor: 100_000, effectiveOwedMinor: 105_000, remainingMinor: 5_000 });
    await recordPayment(admin, entry.id, pay("50"));
    const [row] = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.id, entry.id));
    expect(row.amountOwedMinor).toBe(100_000);
    expect(row.status).toBe("PAID");
  });

  it("decreases and write-offs cannot go below what was paid; a write-off can settle the rest", async () => {
    const { admin, entry } = await approved();
    await recordPayment(admin, entry.id, pay("800"));
    await expect(
      createAdjustment(admin, entry.id, { type: "DECREASE", amount: "300", reason: "Too much" }),
    ).rejects.toThrow(/outstanding balance/);
    const { balance } = await createAdjustment(admin, entry.id, { type: "WRITE_OFF", amount: "200", reason: "Agreed settlement" });
    expect(balance).toMatchObject({ status: "PAID", remainingMinor: 0 });
  });

  it("a void is only possible before any payment, and voided payouts take no payments", async () => {
    const { admin, entry } = await approved();
    const { balance } = await createAdjustment(admin, entry.id, { type: "VOID", reason: "Duplicate entry" });
    expect(balance.status).toBe("VOIDED");
    await expect(recordPayment(admin, entry.id, pay("1"))).rejects.toThrow(/voided/);

    const other = await approved();
    await recordPayment(other.admin, other.entry.id, pay("1"));
    await expect(createAdjustment(other.admin, other.entry.id, { type: "VOID", reason: "Too late" })).rejects.toThrow(
      /write off/,
    );
  });

  it("reopening after a payment is refused (Phase 3 rule still holds)", async () => {
    const { admin, entry, project } = await approved();
    await recordPayment(admin, entry.id, pay("1"));
    await expect(reopenProject(admin, project.id, "Wrong split")).rejects.toThrow(ServiceError);
  });
});

describe("reconciliation", () => {
  it("ledger totals, dashboard totals, the CSV export and the database agree", async () => {
    const a = await approved();
    const b = await approved();
    await recordPayment(a.admin, a.entry.id, pay("400"));
    await createAdjustment(b.admin, b.entry.id, { type: "DECREASE", amount: "100", reason: "Scope reduced" });
    await recordPayment(b.admin, b.entry.id, pay("900"));

    const ledger = await listLedger(a.admin);
    const dashboard = await getDashboard(a.admin);
    expect(dashboard.totals).toEqual(ledger.totals);

    const csv = ledgerToCsv(ledger.rows);
    const dataLines = csv.replace("﻿", "").trim().split("\r\n").slice(1);
    expect(dataLines).toHaveLength(ledger.rows.length);
    const cents = (s: string) => Math.round(Number(s) * 100);
    const columns = dataLines.map((l) => l.split('","').map((c) => c.replace(/^"|"$/g, "")));
    const active = columns.filter((c) => c[13] !== "VOIDED");
    expect(active.reduce((s, c) => s + cents(c[10]), 0)).toBe(ledger.totals.owedMinor);
    expect(active.reduce((s, c) => s + cents(c[11]), 0)).toBe(ledger.totals.paidMinor);
    expect(active.reduce((s, c) => s + cents(c[12]), 0)).toBe(ledger.totals.remainingMinor);

    const rowA = ledger.rows.find((r) => r.id === a.entry.id)!;
    const rowB = ledger.rows.find((r) => r.id === b.entry.id)!;
    expect(rowA).toMatchObject({ status: "PARTIALLY_PAID", paidMinor: 40_000, remainingMinor: 60_000 });
    expect(rowB).toMatchObject({ status: "PAID", adjustmentsMinor: -10_000, effectiveOwedMinor: 90_000, remainingMinor: 0 });
    expect(dashboard.paidInPeriodMinor).toBeGreaterThanOrEqual(130_000);
    expect(dashboard.completedNotFullyPaid.some((p) => p.id === a.project.id)).toBe(true);
    expect(dashboard.completedNotFullyPaid.some((p) => p.id === b.project.id)).toBe(false);
  });

  it("members cannot open the dashboard reports", async () => {
    const { member } = await approved();
    await expect(getDashboard(member)).rejects.toThrow(PermissionError);
  });
});
