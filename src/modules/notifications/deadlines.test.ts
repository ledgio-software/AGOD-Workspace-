import { describe, expect, it } from "vitest";
import { addDays, deadlineAlerts } from "./deadlines";

const today = "2026-10-05";
const t = (id: string, dueDate: string, assignedTo: string | null = "me") => ({
  id,
  title: `Task ${id}`,
  dueDate,
  assignedTo,
  projectCode: "AGOD-2026-001",
  projectId: "p1",
});

describe("deadline alerts", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("flags overdue and due-soon tasks for the assignee, with the due date in the key", () => {
    const alerts = deadlineAlerts("me", [t("a", "2026-10-04"), t("b", "2026-10-05"), t("c", "2026-10-07"), t("d", "2026-10-08")], [], today);
    expect(alerts.map((a) => [a.type, a.dedupeKey])).toEqual([
      ["task.overdue", "task.overdue:a:2026-10-04"],
      ["task.due_soon", "task.due_soon:b:2026-10-05"],
      ["task.due_soon", "task.due_soon:c:2026-10-07"],
    ]);
    expect(alerts[1].title).toBe("Due today: Task b");
  });

  it("tells the project owner about other people's overdue tasks only", () => {
    const alerts = deadlineAlerts("me", [], [t("x", "2026-10-01", "someone"), t("y", "2026-10-01", "me"), t("z", "2026-10-05", "someone")], today);
    expect(alerts.map((a) => a.dedupeKey)).toEqual(["task.overdue_owner:x:2026-10-01"]);
  });
});
