import { describe, expect, it } from "vitest";
import { type PlanInput, type PlanLine, calculateCompensation } from "./calculate";

let n = 0;
const pct = (bps: number, memberId = `m${++n}`, role = "Dev"): PlanLine => ({
  assignmentId: `a${n}`,
  memberId,
  roleOnProject: role,
  splitType: "PERCENTAGE",
  splitBasisPoints: bps,
  splitAmountMinor: null,
});
const fixed = (amount: number, memberId = `m${++n}`, role = "Dev"): PlanLine => ({
  assignmentId: `a${n}`,
  memberId,
  roleOnProject: role,
  splitType: "FIXED_AMOUNT",
  splitBasisPoints: null,
  splitAmountMinor: amount,
});
const plan = (overrides: Partial<PlanInput>): PlanInput => ({
  totalValueMinor: 100_000,
  currency: "GHS",
  splitMode: "PERCENTAGE",
  lines: [],
  ...overrides,
});

describe("percentage plans", () => {
  it("splits exactly when there is no remainder", () => {
    const result = calculateCompensation(plan({ lines: [pct(6_000), pct(4_000)] }));
    expect(result.valid).toBe(true);
    expect(result.lines.map((l) => l.amountMinor)).toEqual([60_000, 40_000]);
    expect(result.unallocatedMinor).toBe(0);
    expect(result.roundingNote).toBeNull();
  });

  it("gives the rounding remainder to the largest share and still reconciles", () => {
    // GHS 1,000.00 split 33.33 / 33.33 / 33.34 -> floors 33330, 33330, 33340 = 100000: no remainder.
    // GHS 100.01 split 50/50 -> 5000.5 each: floors 5000+5000, remainder 1 to the first (tie).
    const result = calculateCompensation(plan({ totalValueMinor: 10_001, lines: [pct(5_000), pct(5_000)] }));
    expect(result.lines.map((l) => l.amountMinor)).toEqual([5_001, 5_000]);
    expect(result.lines[0].roundingAdjustmentMinor).toBe(1);
    expect(result.allocatedMinor).toBe(10_001);
    expect(result.roundingNote).toMatch(/1 pesewa left over/);
  });

  it("puts the remainder on the largest share, not the first", () => {
    const result = calculateCompensation(
      plan({ totalValueMinor: 101, lines: [pct(3_333), pct(3_334), pct(3_333)] }),
    );
    // floors: 33, 33, 33 = 99; remainder 2 -> the 33.34% line
    expect(result.lines.map((l) => l.amountMinor)).toEqual([33, 35, 33]);
    expect(result.allocatedMinor).toBe(101);
  });

  it("is deterministic", () => {
    const input = plan({ totalValueMinor: 99_999, lines: [pct(3_333), pct(3_333), pct(3_334)] });
    expect(calculateCompensation(input)).toEqual(calculateCompensation(input));
  });

  it("rejects totals that are not exactly 100%", () => {
    const result = calculateCompensation(plan({ lines: [pct(6_000), pct(3_999)] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/exactly 100% \(currently 99\.99%\)/);
    expect(calculateCompensation(plan({ lines: [pct(6_000), pct(4_001)] })).valid).toBe(false);
  });

  it("handles a zero project value (voluntary work)", () => {
    const result = calculateCompensation(plan({ totalValueMinor: 0, lines: [pct(10_000)] }));
    expect(result.valid).toBe(true);
    expect(result.lines[0].amountMinor).toBe(0);
  });

  it("allows a zero share", () => {
    const result = calculateCompensation(plan({ lines: [pct(10_000), pct(0)] }));
    expect(result.valid).toBe(true);
    expect(result.lines[1].amountMinor).toBe(0);
  });

  it("handles large values without precision loss", () => {
    const total = 9_007_199_254_740; // ~GHS 90 billion
    const result = calculateCompensation(plan({ totalValueMinor: total, lines: [pct(3_333), pct(6_667)] }));
    expect(result.allocatedMinor).toBe(total);
  });
});

describe("fixed-amount plans", () => {
  it("shows the unallocated amount explicitly", () => {
    const result = calculateCompensation(
      plan({ splitMode: "FIXED_AMOUNT", lines: [fixed(30_000), fixed(50_000)] }),
    );
    expect(result.valid).toBe(true);
    expect(result.allocatedMinor).toBe(80_000);
    expect(result.unallocatedMinor).toBe(20_000);
  });

  it("rejects amounts above the project value", () => {
    const result = calculateCompensation(
      plan({ splitMode: "FIXED_AMOUNT", lines: [fixed(60_000), fixed(50_000)] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/more than the project value/);
  });

  it("accepts amounts that use the whole value", () => {
    expect(calculateCompensation(plan({ splitMode: "FIXED_AMOUNT", lines: [fixed(100_000)] })).valid).toBe(true);
  });
});

describe("plan validation", () => {
  it("rejects mixing split types (decision 3)", () => {
    const result = calculateCompensation(plan({ lines: [pct(5_000), fixed(50_000)] }));
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/project's mode/);
  });

  it("rejects the same member twice in the same role", () => {
    const result = calculateCompensation(plan({ lines: [pct(5_000, "x", "Dev"), pct(5_000, "x", " dev ")] }));
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/twice/);
  });

  it("allows the same member in two different roles", () => {
    expect(calculateCompensation(plan({ lines: [pct(5_000, "x", "Dev"), pct(5_000, "x", "QA")] })).valid).toBe(
      true,
    );
  });

  it("rejects an empty plan", () => {
    expect(calculateCompensation(plan({ lines: [] })).errors.join()).toMatch(/at least one/);
  });

  it("rejects unsupported currencies (MVP is GHS only)", () => {
    expect(calculateCompensation(plan({ currency: "USD", lines: [pct(10_000)] })).errors.join()).toMatch(
      /not supported/,
    );
  });

  it("rejects negative project values", () => {
    expect(calculateCompensation(plan({ totalValueMinor: -1, lines: [pct(10_000)] })).valid).toBe(false);
  });
});
