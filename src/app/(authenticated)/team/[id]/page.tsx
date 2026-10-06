import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, CircleSlash, Clock, FolderKanban, Hourglass, ListChecks, Loader, Wallet } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge, PayoutStatusBadge, ProjectStatusBadge, TaskStatusBadge } from "@/components/badges";
import { Avatar, Card, EmptyState, StatCard, compactTable as ct, table } from "@/components/ui";
import { formatCalendarDate, formatDate, formatDateTime } from "@/lib/dates";
import { adjustmentTypeLabel, paymentMethodLabel, roleLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getContributionHistory } from "@/modules/work/history";

const none = <p className="text-sm text-muted">None.</p>;

export default async function ContributionHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (id !== actor.id && !can(actor, "team.view")) return <AccessDenied what="other people's history" />;
  const h = await getContributionHistory(actor, id);
  if (!h) notFound();
  const { member, workload, totals } = h;
  const back = can(actor, "team.view") ? { href: "/team", label: "Team" } : { href: "/my-work", label: "My work" };
  const history = [
    ...h.payments.map((p) => ({
      id: p.id,
      at: p.paidAt,
      // Payments carry a calendar date only (stored at noon UTC).
      when: formatCalendarDate(p.paidAt.toISOString().slice(0, 10)),
      kind: "payment" as const,
      text: `${p.projectCode} · paid ${formatMoney(p.amountMinor, p.currency)} by ${paymentMethodLabel[p.method]}${p.reference ? `, ref ${p.reference}` : ""}`,
    })),
    ...h.adjustments.map((a) => ({
      id: a.id,
      at: a.createdAt,
      when: formatDateTime(a.createdAt),
      kind: "adjustment" as const,
      text: `${a.projectCode} · ${adjustmentTypeLabel[a.type]}${a.type === "VOID" ? "" : ` ${formatMoney(a.amountMinor)}`}: “${a.reason}”`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="space-y-6">
      <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {back.label}
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={member.name} />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">Contribution history</p>
          <h1 className="text-2xl font-semibold tracking-tight">{member.name}</h1>
          <p className="text-sm text-muted">
            {member.email} · member since {formatDate(member.createdAt)}
          </p>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Badge tone="blue">{roleLabel[member.role]}</Badge>
          <Badge tone={member.active ? "green" : "gray"}>{member.active ? "Active" : "Inactive"}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Active projects" value={workload.activeProjects} icon={FolderKanban} />
        <StatCard label="Open tasks" value={workload.open} icon={ListChecks} />
        <StatCard label="In progress" value={workload.inProgress} icon={Loader} />
        <StatCard label="Completed" value={workload.completed} icon={CircleCheck} tone="good" />
        <StatCard label="Blocked" value={workload.blocked} icon={CircleSlash} tone={workload.blocked ? "bad" : "default"} />
        <StatCard label="Overdue" value={workload.overdue} icon={Clock} tone={workload.overdue ? "warn" : "default"} />
        <StatCard label="Owed" value={formatMoney(totals.owedMinor)} icon={Wallet} />
        <StatCard label="Remaining" value={formatMoney(totals.remainingMinor)} icon={Hourglass} tone={totals.remainingMinor > 0 ? "warn" : "good"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Projects and roles">
          {h.projects.length === 0 ? (
            none
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {h.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/projects/${p.id}`} className="min-w-0 hover:text-brand-600">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">
                      <span className="font-mono">{p.code}</span> · {p.roles.join(", ")}
                    </span>
                  </Link>
                  <ProjectStatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Open tasks">
          {h.openTasks.length === 0 ? (
            <EmptyState icon={ListChecks} title="No open tasks" />
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {h.openTasks.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">{t.title}</span>
                    <span className="block text-xs text-muted">
                      <span className="font-mono">{t.projectCode}</span>
                      {t.dueDate && (
                        <span className={t.overdue ? "text-red-600 dark:text-red-400" : ""}>
                          {" "}
                          · due {formatCalendarDate(t.dueDate)}
                          {t.overdue && " (overdue)"}
                        </span>
                      )}
                      {t.status === "BLOCKED" && <> · {t.blockedReason}</>}
                    </span>
                  </span>
                  <TaskStatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Completed work" description={`${h.completedTasks.length} tasks, ${h.completedMilestones.length} milestones`}>
        {h.completedTasks.length === 0 ? (
          <EmptyState icon={CircleCheck} title="Nothing completed yet" />
        ) : (
          <ul className="space-y-3 text-sm">
            {h.completedTasks.map((t) => (
              <li key={t.id} className="flex gap-3">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                <div className="min-w-0">
                  <p>
                    <span className="font-medium">{t.title}</span> <span className="font-mono text-xs text-muted">{t.projectCode}</span>
                    {t.completedAt && <span className="text-xs text-muted"> · {formatDate(t.completedAt)}</span>}
                  </p>
                  <p className="text-muted">
                    {t.completionNote}
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
          </ul>
        )}
        {h.completedMilestones.length > 0 && (
          <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
            Milestones completed on their projects: {h.completedMilestones.map((m) => `${m.projectCode} ${m.title}`).join(" · ")}
          </p>
        )}
      </Card>

      <Card title="Payouts" bodyClassName={h.payouts.length ? "p-0" : undefined}>
        {h.payouts.length === 0 ? (
          <EmptyState icon={Wallet} title="No payouts yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={ct.th}>Project</th>
                  <th className={ct.th}>Role</th>
                  <th className={`${ct.th} text-right`}>Owed</th>
                  <th className={`${ct.th} text-right`}>Paid</th>
                  <th className={`${ct.th} text-right`}>Remaining</th>
                  <th className={ct.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {h.payouts.map((p) => (
                  <tr key={p.id} className={table.row}>
                    <td className={ct.td}>
                      <Link href={`/payouts/${p.id}`} className="font-mono text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                        {p.projectCode}
                      </Link>
                    </td>
                    <td className={`${ct.td} text-muted`}>{p.roleOnProject}</td>
                    <td className={ct.num}>{formatMoney(p.effectiveOwedMinor, p.currency)}</td>
                    <td className={ct.num}>{formatMoney(p.paidMinor, p.currency)}</td>
                    <td className={`${ct.num} font-medium`}>{formatMoney(p.remainingMinor, p.currency)}</td>
                    <td className={ct.td}>
                      <PayoutStatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong bg-surface-muted/60 font-semibold">
                  <td className={ct.td} colSpan={2}>
                    Total (excluding voided)
                  </td>
                  <td className={ct.num}>{formatMoney(totals.owedMinor)}</td>
                  <td className={ct.num}>{formatMoney(totals.paidMinor)}</td>
                  <td className={ct.num}>{formatMoney(totals.remainingMinor)}</td>
                  <td className={ct.td} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title="Payment and adjustment history">
        {history.length === 0 ? (
          none
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-5 text-sm">
            {history.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className={`absolute -left-[25px] top-1.5 size-2 rounded-full ring-4 ring-surface ${e.kind === "payment" ? "bg-emerald-500" : "bg-amber-500"}`}
                  aria-hidden
                />
                <p>{e.text}</p>
                <p className="text-xs text-muted">
                  {e.kind === "payment" ? "Payment" : "Adjustment"} · {e.when}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
