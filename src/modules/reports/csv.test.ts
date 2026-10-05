import { describe, expect, it } from "vitest";
import type { LedgerRow } from "@/modules/ledger";
import { csvField, ledgerToCsv, periodToCsv, profitabilityToCsv } from "./csv";

const row: LedgerRow = {
  id: "1",
  projectId: "p",
  projectCode: "AGOD-2026-001",
  projectName: 'Payroll "v2"',
  clientType: "EXTERNAL",
  clientName: "=HYPERLINK(\"http://x\")",
  completedAt: new Date("2026-10-05T10:00:00Z"),
  memberId: "m",
  memberName: "Ama",
  memberEmail: "ama@agod.test",
  roleOnProject: "Backend",
  status: "PARTIALLY_PAID",
  currency: "GHS",
  originalMinor: 125_001,
  adjustmentsMinor: -1_000,
  effectiveOwedMinor: 124_001,
  paidMinor: 50_000,
  remainingMinor: 74_001,
  payments: [{ amountMinor: 50_000, paidAt: new Date("2026-10-05T12:00:00Z"), method: "MOBILE_MONEY", reference: "MOMO-123" }],
  approvedByName: "PM",
  approvedAt: new Date("2026-10-05T09:00:00Z"),
  notes: null,
};

describe("ledgerToCsv", () => {
  it("writes exact amounts in major units with headers", () => {
    const csv = ledgerToCsv([row]);
    const [header, line] = csv.replace("﻿", "").trim().split("\r\n");
    expect(header).toContain('"Remaining balance"');
    expect(line).toContain('"1250.01","-10.00","1240.01","500.00","740.01","PARTIALLY_PAID"');
    expect(line).toContain('"2026-10-05 500.00 MOBILE_MONEY MOMO-123"');
  });

  it("escapes quotes and neutralises formulas", () => {
    expect(csvField('Payroll "v2"')).toBe('"Payroll ""v2"""');
    expect(csvField("=1+1")).toBe("\"'=1+1\"");
    expect(csvField("-5")).toBe("\"'-5\"");
    expect(ledgerToCsv([row])).toContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
  });
});

describe("periodToCsv", () => {
  it("lists payments and signed adjustments oldest first", () => {
    const base = { projectCode: "AGOD-2026-001", memberName: "Ama", currency: "GHS", method: null, reference: null, note: null };
    const csv = periodToCsv([
      { ...base, date: new Date("2026-09-20T12:00:00Z"), kind: "DECREASE", amountMinor: -30_000, note: "Scope cut" },
      { ...base, date: new Date("2026-09-02T12:00:00Z"), kind: "PAYMENT", amountMinor: 150_000, method: "CASH", reference: "R-1" },
    ]);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe('"Date","Type","Project code","Recipient","Currency","Amount","Method","Reference","Reason or notes"');
    expect(lines[1]).toBe('"2026-09-02","PAYMENT","AGOD-2026-001","Ama","GHS","1500.00","CASH","R-1",""');
    expect(lines[2]).toBe('"2026-09-20","DECREASE","AGOD-2026-001","Ama","GHS","-300.00","","","Scope cut"');
  });
});

describe("profitabilityToCsv", () => {
  it("writes one row per project with signed amounts", () => {
    const csv = profitabilityToCsv([
      {
        code: "AGOD-2026-001",
        name: "Site",
        status: "COMPLETED",
        category: "WEBSITE",
        clientName: null,
        clientType: "INTERNAL",
        revenueMinor: 0,
        plannedPayoutMinor: 350_000,
        committedPayoutMinor: 350_000,
        paidPayoutMinor: 0,
        costBudgetMinor: 0,
        actualCostMinor: 1_000,
        estimatedProfitMinor: -350_000,
        actualProfitMinor: -351_000,
        actualMarginPct: null,
      },
    ]);
    expect(csv.replace("\uFEFF", "").trim().split("\r\n")[1]).toBe(
      '"AGOD-2026-001","Site","COMPLETED","WEBSITE","Internal","0.00","3500.00","3500.00","0.00","0.00","10.00","-3500.00","-3510.00",""',
    );
  });
});
