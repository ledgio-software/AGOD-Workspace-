import { describe, expect, it } from "vitest";
import { type BalanceInput, payoutBalance } from "./balance";

const entry = (overrides: Partial<BalanceInput> = {}): BalanceInput => ({
  amountOwedMinor: 100_000,
  voided: false,
  adjustments: [],
  payments: [],
  ...overrides,
});

describe("payoutBalance", () => {
  it("starts as owed", () => {
    expect(payoutBalance(entry())).toMatchObject({ status: "OWED", remainingMinor: 100_000, paidMinor: 0 });
  });

  it("a partial payment produces PARTIALLY_PAID", () => {
    expect(payoutBalance(entry({ payments: [{ amountMinor: 40_000 }] }))).toMatchObject({
      status: "PARTIALLY_PAID",
      remainingMinor: 60_000,
    });
  });

  it("the final payment produces PAID", () => {
    const b = payoutBalance(entry({ payments: [{ amountMinor: 40_000 }, { amountMinor: 60_000 }] }));
    expect(b).toMatchObject({ status: "PAID", remainingMinor: 0, paidMinor: 100_000 });
  });

  it("adjustments change the effective amount, never the original", () => {
    const b = payoutBalance(
      entry({
        adjustments: [
          { type: "INCREASE", amountMinor: 5_000 },
          { type: "DECREASE", amountMinor: 2_000 },
          { type: "WRITE_OFF", amountMinor: 1_000 },
        ],
        payments: [{ amountMinor: 50_000 }],
      }),
    );
    expect(b).toMatchObject({
      originalMinor: 100_000,
      adjustmentsMinor: 2_000,
      effectiveOwedMinor: 102_000,
      remainingMinor: 52_000,
      status: "PARTIALLY_PAID",
    });
  });

  it("writing off the remainder settles the entry", () => {
    const b = payoutBalance(entry({ adjustments: [{ type: "WRITE_OFF", amountMinor: 30_000 }], payments: [{ amountMinor: 70_000 }] }));
    expect(b).toMatchObject({ status: "PAID", remainingMinor: 0 });
  });

  it("a void adjustment or a reopened project voids the entry", () => {
    expect(payoutBalance(entry({ adjustments: [{ type: "VOID", amountMinor: 0 }] })).status).toBe("VOIDED");
    expect(payoutBalance(entry({ voided: true })).remainingMinor).toBe(0);
  });
});
