import { describe, expect, it } from "vitest";
import { currentPeriod, periodEnd, periodSchema, previousPeriod } from ".";

describe("periods", () => {
  it("knows month boundaries", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-10")).toBe("2026-09");
    expect(periodEnd("2026-02")).toBe("2026-02-28");
    expect(periodEnd("2028-02")).toBe("2028-02-29");
    expect(periodEnd("2026-12")).toBe("2026-12-31");
  });

  it("uses the operating timezone for the current month", () => {
    expect(currentPeriod(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10");
  });

  it("accepts only YYYY-MM", () => {
    expect(periodSchema.safeParse("2026-09").success).toBe(true);
    expect(periodSchema.safeParse("2026-13").success).toBe(false);
    expect(periodSchema.safeParse("2026-9").success).toBe(false);
  });
});
