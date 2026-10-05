import { describe, expect, it } from "vitest";
import { computeWorkload } from "./workload";

const today = "2026-10-05";
const people = [
  { id: "a", name: "Ama", role: "TEAM_MEMBER", weeklyCapacityHours: 40 },
  { id: "k", name: "Kofi", role: "TEAM_MEMBER", weeklyCapacityHours: 20 },
  { id: "e", name: "Efua", role: "TEAM_MEMBER", weeklyCapacityHours: 0 },
];
const t = (assignedTo: string, dueDate: string | null, estimateHours: number | null, status = "NOT_STARTED", projectId = "p1") => ({
  assignedTo,
  projectId,
  status,
  dueDate,
  estimateHours,
});

describe("workload", () => {
  it("counts open work and compares hours due within 7 days (and overdue) with capacity", () => {
    const rows = computeWorkload(
      people,
      [
        t("a", "2026-10-03", 8, "BLOCKED"), // overdue: counts as planned
        t("a", "2026-10-11", 12, "IN_PROGRESS"), // last day of the window
        t("a", "2026-10-12", 30), // outside the window
        t("a", null, null, "NOT_STARTED", "p2"),
        t("k", "2026-10-06", 25),
      ],
      new Map([["e", new Set(["p3"])]]),
      today,
    );
    const ama = rows.find((r) => r.id === "a")!;
    expect(ama).toMatchObject({
      activeProjects: 2,
      open: 4,
      inProgress: 1,
      blocked: 1,
      overdue: 1,
      dueThisWeek: 1,
      unestimated: 1,
      openHours: 50,
      plannedHours: 20,
      loadPercent: 50,
    });
    expect(rows.map((r) => r.id)).toEqual(["k", "a", "e"]);
    expect(rows[0].loadPercent).toBe(125);
    expect(rows[2]).toMatchObject({ loadPercent: null, activeProjects: 1, open: 0 });
  });
});
