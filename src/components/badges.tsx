import { healthLabel, projectStatusLabel, taskStatusLabel } from "@/lib/labels";
import type { Health, Progress, ProjectStatus, TaskStatus } from "@/modules/projects/rules";

const base = "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const color =
    status === "COMPLETED"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : status === "CANCELLED"
        ? "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
        : status === "PENDING_APPROVAL" || status === "CHANGES_REQUESTED"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
  return <span className={`${base} ${color}`}>{projectStatusLabel[status]}</span>;
}

export function HealthBadge({ health }: { health: Health | null }) {
  if (!health) return <span className="text-xs text-zinc-500">—</span>;
  const color = {
    ON_TRACK: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    AT_RISK: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    BLOCKED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    OVERDUE: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  }[health];
  return <span className={`${base} ${color}`}>{healthLabel[health]}</span>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const color = {
    NOT_STARTED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    BLOCKED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    DONE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    WAIVED: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-900",
  }[status];
  return <span className={`${base} ${color}`}>{taskStatusLabel[status]}</span>;
}

export function ProgressBar({ progress }: { progress: Progress }) {
  if (progress.percent === null) return <span className="text-xs text-zinc-500">No tasks yet</span>;
  return (
    <div className="flex items-center gap-2" title={`${progress.done} of ${progress.total} tasks done`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className="h-full bg-green-600" style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
        {progress.percent}% ({progress.done}/{progress.total})
      </span>
    </div>
  );
}
