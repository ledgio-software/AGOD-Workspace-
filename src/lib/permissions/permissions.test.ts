import { describe, expect, it } from "vitest";
import { type Action, type Actor, PermissionError, assertCan, can } from ".";

const member: Actor = { id: "m", role: "TEAM_MEMBER", orgId: "o" };
const pm: Actor = { id: "p", role: "PROJECT_MANAGER", orgId: "o" };
const admin: Actor = { id: "a", role: "ADMIN", orgId: "o" };

// Expected result per role without resource context: [member, pm, admin]
// Mirrors the role table in the design doc, section 4, plus decisions 4 and 5.
const matrix: Record<Action, [boolean, boolean, boolean]> = {
  "project.view": [false, true, true],
  "project.create": [false, true, true],
  "project.edit": [false, true, true],
  "project.configureCompensation": [false, true, true],
  "project.requestApproval": [false, true, true],
  "project.approve": [false, true, true],
  "project.reject": [false, true, true],
  "project.reopen": [false, false, true],
  "task.update": [false, true, true],
  "payout.viewOwn": [true, true, true],
  "payout.viewAll": [false, true, true],
  "payment.record": [false, false, true],
  "adjustment.create": [false, false, true],
  "ledger.export": [false, true, true],
  "team.view": [false, true, true],
  "team.manage": [false, false, true],
  "audit.viewAll": [false, false, true],
  "audit.viewProject": [false, true, true],
  "project.overrideHealth": [false, true, true],
  "payoutQuestion.raise": [true, true, true],
  "payoutQuestion.review": [false, true, true],
  "payoutQuestion.resolve": [false, false, true],
  "period.view": [false, true, true],
  "period.close": [false, false, true],
  "comment.create": [false, true, true],
  "template.manage": [false, true, true],
  "workload.view": [false, true, true],
  "report.weekly": [false, true, true],
  "finance.view": [false, true, true],
  "finance.manage": [false, true, true],
  "customer.view": [false, true, true],
  "customer.manage": [false, true, true],
  "subscription.view": [false, true, true],
  "subscription.manage": [false, true, true],
  "invoice.view": [false, true, true],
  "invoice.manage": [false, true, true],
  "invoice.recordPayment": [false, false, true],
  "invoice.settings": [false, false, true],
  "google.manage": [false, false, true],
  "company.manage": [false, false, true],
};

describe("can: role matrix", () => {
  for (const [action, expected] of Object.entries(matrix) as [Action, boolean[]][]) {
    it(action, () => {
      expect([can(member, action), can(pm, action), can(admin, action)]).toEqual(expected);
    });
  }
});

describe("can: resource-dependent rules", () => {
  it("a member can view and request approval only for projects they belong to", () => {
    expect(can(member, "project.view", { isProjectMember: true })).toBe(true);
    expect(can(member, "project.requestApproval", { isProjectMember: true })).toBe(true);
    expect(can(member, "project.view", { isProjectMember: false })).toBe(false);
  });

  it("a member can update only their own task", () => {
    expect(can(member, "task.update", { isTaskAssignee: true })).toBe(true);
    expect(can(member, "task.update", { isTaskAssignee: false })).toBe(false);
  });

  it("membership never grants manager-only actions", () => {
    const ctx = { isProjectMember: true, isTaskAssignee: true };
    for (const action of ["project.approve", "project.edit", "payment.record", "team.manage"] as const) {
      expect(can(member, action, ctx)).toBe(false);
    }
  });
});

describe("assertCan", () => {
  it("throws a PermissionError naming the action", () => {
    expect(() => assertCan(pm, "payment.record")).toThrow(PermissionError);
    expect(() => assertCan(pm, "payment.record")).toThrow(/payment\.record/);
  });

  it("returns silently when allowed", () => {
    expect(() => assertCan(admin, "payment.record")).not.toThrow();
  });
});
