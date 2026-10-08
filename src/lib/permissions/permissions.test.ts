import { describe, expect, it } from "vitest";
import { type Action, type Actor, PERMISSION_GROUPS, PermissionError, assertCan, can, effectiveGroups, groupsOf } from ".";

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
  "release.manage": [false, true, true],
  "release.approve": [false, true, true],
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

describe("Phase 28: permission groups and company-made roles", () => {
  const rank = { TEAM_MEMBER: 0, PROJECT_MANAGER: 1, ADMIN: 2 } as const;

  it("every action that needs more than a Team Member is in exactly one group", () => {
    for (const action of Object.keys(matrix) as Action[]) {
      const groups = PERMISSION_GROUPS.filter((g) => g.actions.includes(action));
      const [, pmCan, adminCan] = matrix[action];
      const memberAlways = matrix[action][0];
      const scoped = ["project.view", "project.requestApproval", "comment.create", "audit.viewProject", "release.manage"].includes(action);
      if (memberAlways || scoped) expect(groups, action).toHaveLength(0);
      else expect(groups, action).toHaveLength(1);
      if (groups.length === 1) {
        // The group's level is the lowest built-in role that has the action.
        expect(groups[0].base, action).toBe(pmCan ? "PROJECT_MANAGER" : adminCan ? "ADMIN" : "?");
      }
    }
  });

  it("built-in roles have every group up to their level", () => {
    expect(groupsOf("TEAM_MEMBER")).toEqual([]);
    expect(groupsOf("ADMIN")).toHaveLength(PERMISSION_GROUPS.length);
    for (const key of groupsOf("PROJECT_MANAGER")) {
      expect(rank[PERMISSION_GROUPS.find((g) => g.key === key)!.base]).toBeLessThanOrEqual(1);
    }
  });

  it("a role made from Admin without 'Pay the team' can't record payments, but keeps the rest", () => {
    const finance: Actor = { ...admin, permissions: ["payouts.view", "projects.approve"] };
    expect(can(finance, "payment.record")).toBe(false);
    expect(can(finance, "adjustment.create")).toBe(false);
    expect(can(finance, "payout.viewAll")).toBe(true);
    expect(can(finance, "project.approve")).toBe(true);
    expect(can(finance, "project.edit")).toBe(false);
    // Things no group controls stay as for the base role.
    expect(can(finance, "project.view")).toBe(true);
    expect(can(finance, "payout.viewOwn")).toBe(true);
  });

  it("a role never widens its base: a Project Manager role listing 'Pay the team' still can't pay", () => {
    const pmPlus: Actor = { ...pm, permissions: ["payouts.pay", "team.manage", "company"] };
    expect(can(pmPlus, "payment.record")).toBe(false);
    expect(can(pmPlus, "team.manage")).toBe(false);
    expect(effectiveGroups(pmPlus)).toEqual([]);
  });

  it("without 'Create and edit projects' people still update their own tasks", () => {
    const lead: Actor = { ...pm, permissions: ["team.view"] };
    expect(can(lead, "task.update", { isTaskAssignee: true })).toBe(true);
    expect(can(lead, "task.update", { isTaskAssignee: false })).toBe(false);
    expect(can(lead, "project.create")).toBe(false);
  });

  it("an empty list leaves only what every member has", () => {
    const nothing: Actor = { ...admin, permissions: [] };
    for (const group of PERMISSION_GROUPS) for (const action of group.actions) expect(can(nothing, action), action).toBe(false);
    expect(can(nothing, "payoutQuestion.raise")).toBe(true);
  });

  it("null permissions mean the full built-in role", () => {
    expect(effectiveGroups({ ...pm, permissions: null })).toEqual(groupsOf("PROJECT_MANAGER"));
  });
});
