import { describe, expect, it } from "vitest";
import { agePayouts, forecastByMonth, groupTotals, marginPct, projectFinancials, sumFinancials, utilisationPct } from "./calc";

const base = { revenueMinor: 4_000_000, plannedPayoutMinor: 1_800_000, committedPayoutMinor: 0, paidPayoutMinor: 0, costBudgetMinor: 500_000, actualCostMinor: 0, approved: false };

describe("project financials", () => {
  it("matches the roadmap example: GHS 40,000 value, 18,000 payouts, 5,000 costs → 17,000 profit, 42.5%", () => {
    const f = projectFinancials({ ...base, actualCostMinor: 500_000 });
    expect(f.estimatedProfitMinor).toBe(1_700_000);
    expect(f.estimatedMarginPct).toBe(42.5);
    expect(f.actualProfitMinor).toBe(1_700_000);
  });

  it("uses committed payouts once approved, and tracks budget overruns and outstanding payouts", () => {
    const f = projectFinancials({ ...base, approved: true, committedPayoutMinor: 1_850_000, paidPayoutMinor: 1_000_000, actualCostMinor: 620_000 });
    expect(f.actualProfitMinor).toBe(4_000_000 - 1_850_000 - 620_000);
    expect(f.costOverBudgetMinor).toBe(120_000);
    expect(f.outstandingPayoutMinor).toBe(850_000);
  });

  it("internal projects have no revenue, so no margin and a negative profit", () => {
    const f = projectFinancials({ ...base, revenueMinor: 0 });
    expect(f.actualMarginPct).toBeNull();
    expect(f.actualProfitMinor).toBe(-1_800_000);
    expect(marginPct(1, 3)).toBe(33.3);
  });

  it("adds up totals and groups", () => {
    const a = projectFinancials(base);
    const b = projectFinancials({ ...base, revenueMinor: 1_000_000, plannedPayoutMinor: 900_000, actualCostMinor: 200_000 });
    expect(sumFinancials([a, b])).toEqual({ revenueMinor: 5_000_000, payoutMinor: 2_700_000, costMinor: 200_000, profitMinor: 2_100_000, marginPct: 42, projects: 2 });
    const groups = groupTotals([{ c: "Northwind", f: a }, { c: "Acme", f: b }, { c: "Northwind", f: b }], (r) => r.c, (r) => r.f);
    expect(groups.map((g) => [g.name, g.revenueMinor, g.projects])).toEqual([["Northwind", 5_000_000, 2], ["Acme", 1_000_000, 1]]);
  });
});

describe("ageing, forecast and utilisation", () => {
  it("ages outstanding balances by days since approval", () => {
    const buckets = agePayouts(
      [
        { remainingMinor: 100, approvedOn: "2026-10-01" },
        { remainingMinor: 200, approvedOn: "2026-09-01" },
        { remainingMinor: 300, approvedOn: "2026-08-01" },
        { remainingMinor: 400, approvedOn: "2026-05-01" },
        { remainingMinor: 0, approvedOn: "2026-05-01" },
      ],
      "2026-10-05",
    );
    expect(buckets.map((b) => [b.count, b.remainingMinor])).toEqual([[1, 100], [1, 200], [1, 300], [1, 400]]);
  });

  it("forecasts by month, pulling overdue items into this month", () => {
    const { rows, laterMinor } = forecastByMonth(
      [
        { month: "2026-10", kind: "OWED_NOW", amountMinor: 1000 },
        { month: "2026-08", kind: "IN_PROGRESS", amountMinor: 50 },
        { month: "2026-12", kind: "IN_PROGRESS", amountMinor: 700 },
        { month: "2027-06", kind: "IN_PROGRESS", amountMinor: 9 },
        { month: "2026-10", kind: "PENDING_APPROVAL", amountMinor: 300 },
      ],
      "2026-10",
      3,
    );
    expect(rows.map((r) => [r.month, r.totalMinor])).toEqual([["2026-10", 1350], ["2026-11", 0], ["2026-12", 700]]);
    expect(rows[0]).toMatchObject({ owedNowMinor: 1000, pendingApprovalMinor: 300, inProgressMinor: 50 });
    expect(laterMinor).toBe(9);
    expect(forecastByMonth([], "2026-12", 2).rows.map((r) => r.month)).toEqual(["2026-12", "2027-01"]);
  });

  it("computes utilisation against monthly capacity", () => {
    expect(utilisationPct(80, 40, 4)).toBe(50);
    expect(utilisationPct(10, 0, 4)).toBeNull();
  });
});
