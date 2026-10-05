import { healthLabel, payoutQuestionStatusLabel, payoutStatusLabel, projectStatusLabel, taskStatusLabel } from "@/lib/labels";
import type { Health, Progress, ProjectStatus, TaskStatus } from "@/modules/projects/rules";

const base = "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

// Badge colours: soft background, matching text and a faint ring.
const tones = {
  gray: "bg-zinc-50 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-400/10 dark:text-zinc-400 dark:ring-zinc-400/20",
  blue: "bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-400/10 dark:text-brand-300 dark:ring-brand-400/30",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20",
  red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/20",
} as const;

export function Badge({ tone = "gray", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return <span className={`${base} ${tones[tone]}`}>{children}</span>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const tone =
    status === "COMPLETED"
      ? "green"
      : status === "CANCELLED" || status === "DRAFT"
        ? "gray"
        : status === "PENDING_APPROVAL" || status === "CHANGES_REQUESTED"
          ? "amber"
          : "blue";
  return <Badge tone={tone}>{projectStatusLabel[status]}</Badge>;
}

export function HealthBadge({ health }: { health: Health | null }) {
  if (!health) return <span className="text-xs text-muted">—</span>;
  const tone = ({ ON_TRACK: "green", AT_RISK: "amber", BLOCKED: "red", OVERDUE: "red" } as const)[health];
  return <Badge tone={tone}>{healthLabel[health]}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const tone = (
    {
      NOT_STARTED: "gray",
      IN_PROGRESS: "blue",
      BLOCKED: "red",
      IN_REVIEW: "violet",
      READY_FOR_QA: "amber",
      DONE: "green",
      WAIVED: "gray",
    } as const
  )[status];
  return <Badge tone={tone}>{status === "WAIVED" ? <s>{taskStatusLabel[status]}</s> : taskStatusLabel[status]}</Badge>;
}

export function ProgressBar({ progress }: { progress: Progress }) {
  if (progress.percent === null) return <span className="text-xs text-muted">No tasks yet</span>;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap" title={`${progress.done} of ${progress.total} tasks done`}>
      <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-line">
        <div
          className={`h-full rounded-full ${progress.percent === 100 ? "bg-emerald-500" : "bg-brand-500"}`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted">
        {progress.percent}% ({progress.done}/{progress.total})
      </span>
    </div>
  );
}

export function PayoutStatusBadge({ status }: { status: keyof typeof payoutStatusLabel }) {
  const tone = ({ OWED: "amber", PARTIALLY_PAID: "blue", PAID: "green", DISPUTED: "red", VOIDED: "gray" } as const)[status];
  return <Badge tone={tone}>{payoutStatusLabel[status]}</Badge>;
}

export function QuestionStatusBadge({ status }: { status: keyof typeof payoutQuestionStatusLabel }) {
  const tone = ({ OPEN: "amber", AWAITING_ADMIN: "violet", RESOLVED: "green" } as const)[status];
  return <Badge tone={tone}>{payoutQuestionStatusLabel[status]}</Badge>;
}
