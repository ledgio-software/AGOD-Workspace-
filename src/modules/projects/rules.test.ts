import { describe, expect, it } from "vitest";
import {
  type ProgressTask,
  acceptsTaskUpdates,
  canTransition,
  isEditable,
  calculatedHealth,
  isTaskOverdue,
  personalProgress,
  projectHealth,
  projectProgress,
} from "./rules";

const task = (status: ProgressTask["status"], overrides: Partial<ProgressTask> = {}): ProgressTask => ({
  status,
  required: true,
  dueDate: null,
  ...overrides,
});

describe("status transitions", () => {
  it("follows the planning lifecycle", () => {
    expect(canTransition("DRAFT", "PLANNING")).toBe(true);
    expect(canTransition("PLANNING", "IN_PROGRESS")).toBe(true);
    expect(canTransition("CHANGES_REQUESTED", "IN_PROGRESS")).toBe(true);
  });

  it("never lets a manual change skip the approval flow", () => {
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(false);
    expect(canTransition("IN_PROGRESS", "PENDING_APPROVAL")).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("CANCELLED", "PLANNING")).toBe(false);
    expect(canTransition("PENDING_APPROVAL", "IN_PROGRESS")).toBe(false);
  });

  it("locks editing once approval is requested", () => {
    expect(isEditable("IN_PROGRESS")).toBe(true);
    expect(isEditable("PENDING_APPROVAL")).toBe(false);
    expect(isEditable("COMPLETED")).toBe(false);
    expect(acceptsTaskUpdates("DRAFT")).toBe(false);
    expect(acceptsTaskUpdates("COMPLETED")).toBe(false);
  });
});

describe("progress", () => {
  it("counts completed required tasks over required tasks", () => {
    const tasks = [task("DONE"), task("IN_PROGRESS"), task("DONE", { required: false }), task("NOT_STARTED")];
    expect(projectProgress(tasks)).toEqual({ done: 1, total: 3, percent: 33 });
  });

  it("removes waived tasks from both sides", () => {
    expect(projectProgress([task("DONE"), task("WAIVED")])).toEqual({ done: 1, total: 1, percent: 100 });
  });

  it("has no percentage without tasks", () => {
    expect(projectProgress([]).percent).toBeNull();
  });

  it("personal progress includes optional tasks", () => {
    expect(personalProgress([task("DONE", { required: false }), task("BLOCKED")]).percent).toBe(50);
  });
});

describe("health", () => {
  const today = "2026-10-05";
  const active = { status: "IN_PROGRESS" as const, targetDate: "2026-12-01" };

  it("is on track by default", () => {
    expect(projectHealth(active, [task("IN_PROGRESS")], today)).toBe("ON_TRACK");
  });

  it("is overdue past the target date", () => {
    expect(projectHealth({ ...active, targetDate: "2026-10-04" }, [], today)).toBe("OVERDUE");
  });

  it("is blocked when a required task is blocked", () => {
    expect(projectHealth(active, [task("BLOCKED")], today)).toBe("BLOCKED");
    expect(projectHealth(active, [task("BLOCKED", { required: false })], today)).toBe("ON_TRACK");
  });

  it("is at risk with an overdue task", () => {
    expect(isTaskOverdue(task("IN_PROGRESS", { dueDate: "2026-10-01" }), today)).toBe(true);
    expect(isTaskOverdue(task("DONE", { dueDate: "2026-10-01" }), today)).toBe(false);
    expect(projectHealth(active, [task("IN_PROGRESS", { dueDate: "2026-10-01" })], today)).toBe("AT_RISK");
  });

  it("is at risk close to the target date with little done", () => {
    const soon = { ...active, targetDate: "2026-10-10" };
    expect(projectHealth(soon, [task("DONE"), task("NOT_STARTED")], today)).toBe("AT_RISK");
    expect(projectHealth(soon, [task("DONE"), task("DONE")], today)).toBe("ON_TRACK");
  });

  it("uses a PM override while one is set, but never for closed projects", () => {
    expect(projectHealth({ ...active, healthOverride: "AT_RISK" }, [task("IN_PROGRESS")], today)).toBe("AT_RISK");
    expect(projectHealth({ ...active, healthOverride: "ON_TRACK" }, [task("BLOCKED")], today)).toBe("ON_TRACK");
    expect(calculatedHealth({ ...active, healthOverride: "ON_TRACK" } as typeof active, [task("BLOCKED")], today)).toBe("BLOCKED");
    expect(projectHealth({ ...active, status: "COMPLETED", healthOverride: "AT_RISK" }, [], today)).toBeNull();
  });

  it("does not apply to completed or cancelled projects", () => {
    expect(projectHealth({ status: "COMPLETED", targetDate: "2020-01-01" }, [], today)).toBeNull();
  });
});
