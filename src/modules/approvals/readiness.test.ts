import { describe, expect, it } from "vitest";
import type { PlanResult } from "@/modules/compensation/calculate";
import { approvalReadiness } from "./readiness";

const validPlan: PlanResult = { valid: true, errors: [], lines: [], allocatedMinor: 0, unallocatedMinor: 0, roundingNote: null };
const t = (status: "DONE" | "WAIVED" | "IN_PROGRESS" | "BLOCKED", required = true) => ({
  id: status,
  title: status,
  status,
  required,
});

describe("approvalReadiness", () => {
  it("is ready when the plan is valid and required tasks are done or waived", () => {
    expect(approvalReadiness(validPlan, [t("DONE"), t("WAIVED"), t("IN_PROGRESS", false)]).ready).toBe(true);
  });

  it("lists incomplete required tasks (overridable with a reason)", () => {
    const r = approvalReadiness(validPlan, [t("DONE"), t("BLOCKED")]);
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual([]);
    expect(r.incompleteTasks.map((x) => x.status)).toEqual(["BLOCKED"]);
  });

  it("an invalid plan is a hard blocker", () => {
    const r = approvalReadiness({ ...validPlan, valid: false, errors: ["Percentages must total exactly 100%"] }, []);
    expect(r.ready).toBe(false);
    expect(r.blockers[0]).toMatch(/Compensation plan: Percentages/);
  });
});
