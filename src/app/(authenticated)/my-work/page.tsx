import Link from "next/link";
import {
  Activity,
  Bell,
  CircleCheck,
  CircleSlash,
  Clock,
  FolderKanban,
  ListChecks,
  Loader,
  Percent,
  Wallet,
} from "lucide-react";
import { Badge, HealthBadge, ProgressBar, ProjectStatusBadge, TaskStatusBadge } from "@/components/badges";
import { Card, EmptyState, PageHeader, StatCard, table } from "@/components/ui";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { describeAuditAction, payoutStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { acceptsTaskUpdates } from "@/modules/projects/rules";
import { refreshDeadlineAlertsQuietly } from "@/modules/notifications/deadlines";
import { getMyWork } from "@/modules/work";
import { taskProgressAction } from "../projects/actions";
import { TaskProgressForm } from "../projects/[id]/workspace-forms";
import { MarkReadButton } from "./mark-read";
import { ExpandableList } from "@/components/expandable-list";

const NOTIFICATIONS_SHOWN = 5;
const ACTIVITY_SHOWN = 12;

const payoutTone = { OWED: "amber", PARTIALLY_PAID: "blue", PAID: "green", DISPUTED: "red", VOIDED: "gray" } as const;

export default async function MyWorkPage() {
  const actor = await requireUser();
  await refreshDeadlineAlertsQuietly(actor);
  const work = await getMyWork(actor);
  const openTasks = work.tasks.filter((t) => t.status !== "DONE" && t.status !== "WAIVED");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="My work"
        title="Your work and payouts"
        description="What is assigned to you, what you have completed, and what you are owed."
        actions={
          <Link href={`/team/${actor.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
            Full contribution history →
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Assigned" value={work.summary.assigned} icon={ListChecks} />
        <StatCard label="Completed" value={work.summary.completed} icon={CircleCheck} tone="good" />
        <StatCard label="In progress" value={work.summary.inProgress} icon={Loader} />
        <StatCard label="Blocked" value={work.summary.blocked} icon={CircleSlash} tone={work.summary.blocked ? "bad" : "default"} />
        <StatCard label="Overdue" value={work.summary.overdue} icon={Clock} tone={work.summary.overdue ? "warn" : "default"} />
        <StatCard
          label="Completion"
          value={work.summary.progress.percent === null ? "—" : `${work.summary.progress.percent}%`}
          icon={Percent}
        />
      </div>

      <Card title="My tasks" description="Update progress here; completed work needs a short note." aside={<Badge tone="gray">{openTasks.length} open</Badge>}>
        {openTasks.length === 0 ? (
          <EmptyState icon={ListChecks} title="No open tasks">You&apos;re all caught up.</EmptyState>
        ) : (
          <ul className="-my-4 divide-y divide-line">
            {openTasks.map((task) => (
              <li key={task.id} className="grid gap-4 py-4 md:grid-cols-[1fr_18rem]">
                <div className="min-w-0 space-y-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{task.title}</span>
                    <TaskStatusBadge status={task.status} />
                    {task.overdue && <Badge tone="red">Overdue</Badge>}
                  </div>
                  <p className="text-muted">
                    <Link href={`/projects/${task.projectId}`} className="hover:text-brand-600">
                      {task.projectCode} · {task.projectName}
                    </Link>
                    {task.dueDate && <> · due {formatCalendarDate(task.dueDate)}</>}
                  </p>
                  {task.status === "BLOCKED" && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800 dark:bg-red-950/40 dark:text-red-200">
                      <span className="font-medium">Blocked:</span> {task.blockedReason}. <span className="font-medium">Needs:</span>{" "}
                      {task.blockedNeeds}
                    </p>
                  )}
                </div>
                {acceptsTaskUpdates(task.projectStatus) ? (
                  <TaskProgressForm action={taskProgressAction.bind(null, task.projectId, task.id)} status={task.status} today={work.today} />
                ) : (
                  <p className="text-xs text-muted">The project isn&apos;t accepting progress updates right now.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {work.unreadNotifications.length > 0 && (
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <Bell className="size-4 text-brand-600" aria-hidden />
              Notifications
              <Badge tone="blue">{work.unreadNotifications.length} new</Badge>
            </span>
          }
          aside={<MarkReadButton />}
        >
          <ExpandableList
            initial={NOTIFICATIONS_SHOWN}
            className="-my-2 divide-y divide-line"
            items={work.unreadNotifications.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-2.5 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{n.title}</span> <span className="text-muted">{n.message}</span>
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(n.createdAt)}</p>
                </div>
                {n.entityType === "project" && n.entityId && (
                  <Link href={`/projects/${n.entityId}`} className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
                    Open
                  </Link>
                )}
              </li>
            ))}
          />
        </Card>
      )}

      <Card title="Current projects" aside={<Badge tone="gray">{work.currentProjects.length}</Badge>}>
        {work.currentProjects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="You are not on any active project" />
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Project</th>
                  <th className={table.th}>My role</th>
                  <th className={table.th}>Project progress</th>
                  <th className={table.th}>My tasks</th>
                  <th className={table.th}>Health</th>
                  <th className={table.th}>Target</th>
                </tr>
              </thead>
              <tbody>
                {work.currentProjects.map((p) => (
                  <tr key={p.id} className={table.row}>
                    <td className={table.td}>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:text-brand-600">
                        {p.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        {p.code} <ProjectStatusBadge status={p.status} />
                      </div>
                    </td>
                    <td className={table.td}>{p.myRoles.join(", ") || "—"}</td>
                    <td className={table.td}>
                      <ProgressBar progress={p.projectProgress} />
                    </td>
                    <td className={table.td}>
                      <ProgressBar progress={p.myProgress} />
                    </td>
                    <td className={table.td}>
                      <HealthBadge health={p.health} />
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>{formatCalendarDate(p.targetDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card id="payouts" title="My payouts" description="Created only when a project is approved, never by completing tasks.">
        <dl className="mb-5 grid grid-cols-3 gap-4 rounded-lg bg-surface-muted p-4 text-sm">
          <div>
            <dt className="text-xs text-muted">Total owed</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(work.payouts.owedMinor)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Total paid</dt>
            <dd className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(work.payouts.paidMinor)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Remaining</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(work.payouts.remainingMinor)}</dd>
          </div>
        </dl>
        {work.payouts.rows.length === 0 ? (
          <EmptyState icon={Wallet} title="No payouts yet" />
        ) : (
          <div className="-mx-5 -mb-4 overflow-x-auto border-t border-line">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Project</th>
                  <th className={`${table.th} text-right`}>Owed</th>
                  <th className={`${table.th} text-right`}>Paid</th>
                  <th className={`${table.th} text-right`}>Remaining</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th} />
                </tr>
              </thead>
              <tbody>
                {work.payouts.rows.map((r) => (
                  <tr key={r.id} className={table.row}>
                    <td className={table.td}>
                      <Link href={`/payouts/${r.id}`} className="font-medium hover:text-brand-600">
                        {r.projectName}
                      </Link>
                      <div className="text-xs text-muted">{r.projectCode}</div>
                    </td>
                    <td className={table.num}>{formatMoney(r.owedMinor, r.currency)}</td>
                    <td className={table.num}>{formatMoney(r.paidMinor, r.currency)}</td>
                    <td className={`${table.num} font-medium`}>{formatMoney(r.remainingMinor, r.currency)}</td>
                    <td className={table.td}>
                      <Badge tone={payoutTone[r.status]}>{payoutStatusLabel[r.status]}</Badge>
                    </td>
                    <td className={`${table.td} text-right`}>
                      <Link href={`/payouts/${r.id}#questions`} className="whitespace-nowrap text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
                        Ask a question
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Completed work">
          {work.completedTasks.length === 0 && work.completedMilestones.length === 0 ? (
            <EmptyState icon={CircleCheck} title="Nothing completed yet" />
          ) : (
            <ul className="space-y-3 text-sm">
              {work.completedTasks.map((t) => (
                <li key={t.id} className="flex gap-3">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">{t.title}</span> <span className="text-muted">· {t.projectCode}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {t.completedAt && formatCalendarDate(t.completedAt.toISOString().slice(0, 10))} · {t.completionNote}
                      {t.evidenceUrl && (
                        <>
                          {" · "}
                          <a href={t.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                            evidence
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
              {work.completedMilestones.map((m) => (
                <li key={m.id} className="flex gap-3">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-brand-500" aria-hidden />
                  <div className="min-w-0">
                    <p>
                      Milestone <span className="font-medium">{m.title}</span> <span className="text-muted">· {m.projectCode}</span>
                    </p>
                    {m.completedAt && <p className="text-xs text-muted">{formatDateTime(m.completedAt)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Activity">
          {work.timeline.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" />
          ) : (
            <ExpandableList
              as="ol"
              initial={ACTIVITY_SHOWN}
              className="relative space-y-4 border-l border-line pl-5"
              items={work.timeline.map((e) => (
                <li key={`${e.kind}-${e.id}`} className="relative text-sm">
                  <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-line-strong ring-4 ring-surface" aria-hidden />
                  <p>
                    {e.kind === "action" ? (
                      <>
                        You {describeAuditAction(e.text)}
                        {e.projectCode && <span className="text-muted"> · {e.projectCode}</span>}
                        {e.reason && <span className="text-muted"> — “{e.reason}”</span>}
                      </>
                    ) : (
                      e.text
                    )}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(e.at)}</p>
                </li>
              ))}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
