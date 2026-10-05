// Pure project rules: status transitions, edit locks, progress and health.

export type ProjectStatus =
  | "DRAFT"
  | "PLANNING"
  | "IN_PROGRESS"
  | "PENDING_APPROVAL"
  | "CHANGES_REQUESTED"
  | "COMPLETED"
  | "CANCELLED";

export type TaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "WAIVED";

/**
 * Manual status changes a PM/Admin can make in Phase 2. The approval flow (PENDING_APPROVAL,
 * CHANGES_REQUESTED, COMPLETED, reopening) has its own guarded actions in Phase 3.
 */
const manualTransitions: Partial<Record<ProjectStatus, ProjectStatus[]>> = {
  DRAFT: ["PLANNING", "CANCELLED"],
  PLANNING: ["DRAFT", "IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["PLANNING", "CANCELLED"],
  CHANGES_REQUESTED: ["IN_PROGRESS", "CANCELLED"],
};

export function allowedManualTransitions(from: ProjectStatus): ProjectStatus[] {
  return manualTransitions[from] ?? [];
}

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return allowedManualTransitions(from).includes(to);
}

/** Details, team and compensation can change only before approval is requested. */
export function isEditable(status: ProjectStatus): boolean {
  return status === "DRAFT" || status === "PLANNING" || status === "IN_PROGRESS" || status === "CHANGES_REQUESTED";
}

/** Members can record progress while work is underway. */
export function acceptsTaskUpdates(status: ProjectStatus): boolean {
  return status === "PLANNING" || status === "IN_PROGRESS" || status === "CHANGES_REQUESTED";
}

export type ProgressTask = {
  status: TaskStatus;
  required: boolean;
  dueDate: string | null;
};

export type Progress = { done: number; total: number; percent: number | null };

/**
 * Derived, never typed in: completed required tasks / required tasks. Waived tasks are removed
 * from both sides (an explicit decision that the task is no longer needed).
 */
export function projectProgress(tasks: ProgressTask[]): Progress {
  const counted = tasks.filter((task) => task.required && task.status !== "WAIVED");
  return toProgress(counted);
}

/** A member's own progress: all their non-waived tasks. */
export function personalProgress(tasks: ProgressTask[]): Progress {
  return toProgress(tasks.filter((task) => task.status !== "WAIVED"));
}

function toProgress(tasks: ProgressTask[]): Progress {
  const done = tasks.filter((task) => task.status === "DONE").length;
  return { done, total: tasks.length, percent: tasks.length === 0 ? null : Math.round((done / tasks.length) * 100) };
}

export function isTaskOverdue(task: ProgressTask, today: string): boolean {
  return task.dueDate !== null && task.dueDate < today && task.status !== "DONE" && task.status !== "WAIVED";
}

export type Health = "ON_TRACK" | "AT_RISK" | "BLOCKED" | "OVERDUE";

/**
 * Project health, separate from lifecycle status (design doc section 8):
 * - Overdue: past the target date and not completed.
 * - Blocked: a required task is blocked.
 * - At risk: a task is overdue, or the target is within 7 days with less than 80% done.
 */
export function projectHealth(
  project: { status: ProjectStatus; targetDate: string | null; healthOverride?: Health | null },
  tasks: ProgressTask[],
  today: string,
): Health | null {
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return null;
  // Roadmap 2.2: a PM's override (always with a reason) replaces the calculation until cleared.
  if (project.healthOverride) return project.healthOverride;
  return calculatedHealth(project, tasks, today);
}

/** The health the rules give, ignoring any override (shown next to an override). */
export function calculatedHealth(
  project: { status: ProjectStatus; targetDate: string | null },
  tasks: ProgressTask[],
  today: string,
): Health | null {
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return null;
  if (project.targetDate !== null && project.targetDate < today) return "OVERDUE";
  if (tasks.some((task) => task.required && task.status === "BLOCKED")) return "BLOCKED";
  if (tasks.some((task) => isTaskOverdue(task, today))) return "AT_RISK";
  if (project.targetDate !== null && daysBetween(today, project.targetDate) <= 7) {
    const { percent } = projectProgress(tasks);
    if (percent !== null && percent < 80) return "AT_RISK";
  }
  return "ON_TRACK";
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
