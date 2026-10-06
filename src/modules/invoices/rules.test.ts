import { describe, expect, it } from "vitest";
import { balanceMinor, formatInvoiceNumber, invoiceAlerts, invoiceState, nextBillingPeriod } from "./rules";

describe("invoice state", () => {
  const issued = { status: "ISSUED" as const, totalMinor: 10_000, paidMinor: 0, dueDate: "2026-10-20" };
  it("works out open, partly paid, paid and overdue from payments and the due date", () => {
    expect(invoiceState(issued, "2026-10-06")).toBe("OPEN");
    expect(invoiceState({ ...issued, paidMinor: 4_000 }, "2026-10-06")).toBe("PARTLY_PAID");
    expect(invoiceState({ ...issued, paidMinor: 10_000 }, "2026-11-30")).toBe("PAID");
    expect(invoiceState({ ...issued, paidMinor: 4_000 }, "2026-10-21")).toBe("OVERDUE");
    expect(invoiceState({ ...issued, status: "DRAFT" }, "2026-12-01")).toBe("DRAFT");
    expect(invoiceState({ ...issued, status: "VOID" }, "2026-12-01")).toBe("VOID");
    expect(balanceMinor({ ...issued, paidMinor: 4_000 })).toBe(6_000);
    expect(balanceMinor({ ...issued, status: "VOID" })).toBe(0);
  });
  it("numbers invoices per year", () => {
    expect(formatInvoiceNumber("2026", 7)).toBe("INV-2026-0007");
    expect(formatInvoiceNumber("2026", 12345)).toBe("INV-2026-12345");
  });
});

describe("subscription billing periods", () => {
  const base = { startDate: "2026-01-15", endDate: null, lastPeriodEnd: null };
  it("bills one period at a time from the start date", () => {
    expect(nextBillingPeriod({ ...base, billingCadence: "MONTHLY" })).toEqual({ start: "2026-01-15", end: "2026-02-14" });
    expect(nextBillingPeriod({ ...base, billingCadence: "MONTHLY", lastPeriodEnd: "2026-02-14" })).toEqual({ start: "2026-02-15", end: "2026-03-14" });
    expect(nextBillingPeriod({ ...base, billingCadence: "QUARTERLY" })).toEqual({ start: "2026-01-15", end: "2026-04-14" });
    expect(nextBillingPeriod({ ...base, billingCadence: "ANNUAL" })).toEqual({ start: "2026-01-15", end: "2027-01-14" });
  });
  it("stops at the end date, bills one-time once and leaves custom billing to manual lines", () => {
    expect(nextBillingPeriod({ ...base, endDate: "2026-02-01", billingCadence: "MONTHLY" })).toEqual({ start: "2026-01-15", end: "2026-02-01" });
    expect(nextBillingPeriod({ ...base, endDate: "2026-02-01", billingCadence: "MONTHLY", lastPeriodEnd: "2026-02-01" })).toBeNull();
    expect(nextBillingPeriod({ ...base, billingCadence: "ONE_TIME" })).toEqual({ start: "2026-01-15", end: "2026-01-15" });
    expect(nextBillingPeriod({ ...base, billingCadence: "ONE_TIME", lastPeriodEnd: "2026-01-15" })).toBeNull();
    expect(nextBillingPeriod({ ...base, billingCadence: "CUSTOM" })).toBeNull();
  });
});

describe("overdue reminders", () => {
  const inv = { id: "i1", number: "INV-2026-0001", customerName: "Northwind", ownerId: "owner", dueDate: "2026-10-01", balanceMinor: 5_000, balance: "GHS 50.00" };
  it("tells the account owner once per due date, and Admins after two weeks", () => {
    expect(invoiceAlerts("owner", false, [inv], "2026-10-06").map((a) => a.dedupeKey)).toEqual(["invoice.overdue:i1:2026-10-01"]);
    expect(invoiceAlerts("owner", false, [inv], "2026-10-01")).toEqual([]); // due today: not overdue yet
    expect(invoiceAlerts("owner", false, [{ ...inv, balanceMinor: 0 }], "2026-10-06")).toEqual([]);
    expect(invoiceAlerts("admin", true, [inv], "2026-10-10")).toEqual([]);
    expect(invoiceAlerts("admin", true, [inv], "2026-10-15").map((a) => a.type)).toEqual(["invoice.overdue_escalated"]);
  });
});
