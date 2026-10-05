import Link from "next/link";
import { HealthBadge, ProgressBar, ProjectStatusBadge, TaskStatusBadge } from "@/components/badges";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { describeAuditAction, payoutStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { acceptsTaskUpdates } from "@/modules/projects/rules";
import { getMyWork } from "@/modules/work";
import { taskProgressAction } from "../projects/actions";
import { TaskProgressForm } from "../projects/[id]/workspace-forms";
import { MarkReadButton } from "./mark-read";

function Card({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default async function MyWorkPage() {
  const actor = await requireUser();
  const work = await getMyWork(actor);
  const openTasks = work.tasks.filter((t) => t.status !== "DONE" && t.status !== "WAIVED");

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">My work</h1>
        <p className="text-sm text-zinc-500">What is assigned to you, what you have completed, and what you are owed.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Card label="Assigned" value={work.summary.assigned} />
        <Card label="Completed" value={work.summary.completed} />
        <Card label="In progress" value={work.summary.inProgress} />
        <Card label="Blocked" value={work.summary.blocked} tone={work.summary.blocked ? "bad" : undefined} />
        <Card label="Overdue" value={work.summary.overdue} tone={work.summary.overdue ? "warn" : undefined} />
        <Card label="Completion" value={work.summary.progress.percent === null ? "—" : `${work.summary.progress.percent}%`} />
      </div>

      {work.unreadNotifications.length > 0 && (
        <Section title={`Notifications (${work.unreadNotifications.length})`} aside={<MarkReadButton />}>
          <ul className="space-y-1 text-sm">
            {work.unreadNotifications.map((n) => (
              <li key={n.id}>
                <span className="text-zinc-500">{formatDateTime(n.createdAt)}</span> · <strong>{n.title}</strong> {n.message}
                {n.entityType === "project" && n.entityId && (
                  <>
                    {" "}
                    <Link href={`/projects/${n.entityId}`} className="underline">
                      open
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Current projects">
        {work.currentProjects.length === 0 ? (
          <p className="text-sm text-zinc-500">You are not on any active project.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="py-2 pr-4 font-medium">Project</th>
                  <th className="py-2 pr-4 font-medium">My role</th>
                  <th className="py-2 pr-4 font-medium">Project progress</th>
                  <th className="py-2 pr-4 font-medium">My tasks</th>
                  <th className="py-2 pr-4 font-medium">Health</th>
                  <th className="py-2 font-medium">Target</th>
                </tr>
              </thead>
              <tbody>
                {work.currentProjects.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4">
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        {p.code} <ProjectStatusBadge status={p.status} />
                      </div>
                    </td>
                    <td className="py-2 pr-4">{p.myRoles.join(", ") || "—"}</td>
                    <td className="py-2 pr-4">
                      <ProgressBar progress={p.projectProgress} />
                    </td>
                    <td className="py-2 pr-4">
                      <ProgressBar progress={p.myProgress} />
                    </td>
                    <td className="py-2 pr-4">
                      <HealthBadge health={p.health} />
                    </td>
                    <td className="py-2">{formatCalendarDate(p.targetDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="My tasks">
        {openTasks.length === 0 ? (
          <p className="text-sm text-zinc-500">No open tasks.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {openTasks.map((task) => (
              <li key={task.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_18rem]">
                <div className="space-y-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{task.title}</span>
                    <TaskStatusBadge status={task.status} />
                    {task.overdue && <span className="text-xs font-medium text-red-600">overdue</span>}
                  </div>
                  <div className="text-zinc-500">
                    <Link href={`/projects/${task.projectId}`} className="hover:underline">
                      {task.projectCode} {task.projectName}
                    </Link>
                    {task.dueDate && ` · due ${formatCalendarDate(task.dueDate)}`}
                  </div>
                  {task.status === "BLOCKED" && (
                    <p className="text-red-700 dark:text-red-400">
                      Blocked: {task.blockedReason}. Needs: {task.blockedNeeds}
                    </p>
                  )}
                </div>
                {acceptsTaskUpdates(task.projectStatus) ? (
                  <TaskProgressForm
                    action={taskProgressAction.bind(null, task.projectId, task.id)}
                    status={task.status}
                    today={work.today}
                  />
                ) : (
                  <p className="text-xs text-zinc-500">The project isn&apos;t accepting progress updates right now.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Completed work">
        {work.completedTasks.length === 0 && work.completedMilestones.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing completed yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {work.completedTasks.map((t) => (
              <li key={t.id}>
                <strong>{t.title}</strong> <span className="text-zinc-500">({t.projectCode})</span> · completed{" "}
                {t.completedAt && formatCalendarDate(t.completedAt.toISOString().slice(0, 10))} · {t.completionNote}
                {t.evidenceUrl && (
                  <>
                    {" "}
                    <a href={t.evidenceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      evidence
                    </a>
                  </>
                )}
              </li>
            ))}
            {work.completedMilestones.map((m) => (
              <li key={m.id}>
                Milestone <strong>{m.title}</strong> <span className="text-zinc-500">({m.projectCode})</span> completed
                {m.completedAt && ` ${formatDateTime(m.completedAt)}`}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="My payouts">
        <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
          <Card label="Total owed" value={formatMoney(work.payouts.owedMinor)} />
          <Card label="Total paid" value={formatMoney(work.payouts.paidMinor)} />
          <Card label="Remaining" value={formatMoney(work.payouts.owedMinor - work.payouts.paidMinor)} />
        </div>
        {work.payouts.rows.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No payouts yet. A payout is created only when a project is approved, never by completing tasks.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {work.payouts.rows.map((r) => (
              <li key={r.id}>
                {r.projectCode} {r.projectName}: owed {formatMoney(r.owedMinor, r.currency)}, paid {formatMoney(r.paidMinor, r.currency)} ·{" "}
                {payoutStatusLabel[r.status]}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Activity">
        {work.timeline.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {work.timeline.map((e) => (
              <li key={`${e.kind}-${e.id}`}>
                <span className="text-zinc-500">{formatDateTime(e.at)}</span> ·{" "}
                {e.kind === "action" ? (
                  <>
                    You {describeAuditAction(e.text)}
                    {e.projectCode && <span className="text-zinc-500"> ({e.projectCode})</span>}
                    {e.reason && <span className="text-zinc-500"> — “{e.reason}”</span>}
                  </>
                ) : (
                  e.text
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
