import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Banknote,
  CircleAlert,
  Clock,
  Hourglass,
  Inbox,
  ListChecks,
  Repeat,
  Wallet,
} from "lucide-react";
import { RenewalBadge, TaskStatusBadge } from "@/components/badges";
import { inputClass } from "@/components/form";
import { Avatar, ButtonLink, Callout, Card, EmptyState, List, ListRow, PageHeader, StatCard, buttonClass } from "@/components/ui";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { adjustmentTypeLabel, describeAuditAction, payoutStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { questionsWaitingOn } from "@/modules/questions";
import { getDashboard } from "@/modules/reports";
import { refreshDeadlineAlertsQuietly } from "@/modules/notifications/deadlines";
import { listSubscriptions, refreshRenewalAlertsQuietly } from "@/modules/subscriptions";
import { getMyWork } from "@/modules/work";

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
      {label}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}

async function MemberDashboard({ user }: { user: Awaited<ReturnType<typeof requireUser>> }) {
  const work = await getMyWork(user);
  const openTasks = work.tasks.filter((t) => t.status !== "DONE" && t.status !== "WAIVED");
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${firstName(user.name)}`}
        description="Your open work and what you are owed, at a glance."
        actions={<ButtonLink href="/my-work" variant="primary">Open My work</ButtonLink>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open tasks" value={openTasks.length} icon={ListChecks} href="/my-work" />
        <StatCard
          label="Overdue"
          value={work.summary.overdue}
          icon={Clock}
          tone={work.summary.overdue ? "warn" : "default"}
          href="/my-work"
        />
        <StatCard label="Owed to you" value={formatMoney(work.payouts.owedMinor)} icon={Wallet} href="/my-work#payouts" />
        <StatCard
          label="Still to be paid"
          value={formatMoney(work.payouts.remainingMinor)}
          icon={Hourglass}
          tone={work.payouts.remainingMinor > 0 ? "warn" : "good"}
          href="/my-work#payouts"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Next up" aside={<ViewAll href="/my-work" />}>
          {openTasks.length === 0 ? (
            <EmptyState icon={ListChecks} title="No open tasks">You&apos;re all caught up.</EmptyState>
          ) : (
            <List>
              {openTasks.slice(0, 6).map((t) => (
                <ListRow key={t.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.title}</p>
                    <p className="truncate text-xs text-muted">
                      {t.projectCode} · {t.projectName}
                      {t.dueDate && ` · due ${formatCalendarDate(t.dueDate)}`}
                    </p>
                  </div>
                  <TaskStatusBadge status={t.status} />
                </ListRow>
              ))}
            </List>
          )}
        </Card>
        <Card title="My payouts" aside={<ViewAll href="/my-work#payouts" />}>
          {work.payouts.rows.length === 0 ? (
            <EmptyState icon={Wallet} title="No payouts yet">
              A payout is created when a project you worked on is approved.
            </EmptyState>
          ) : (
            <List>
              {work.payouts.rows.slice(0, 6).map((r) => (
                <ListRow key={r.id}>
                  <Link href={`/payouts/${r.id}`} className="min-w-0 hover:text-brand-600">
                    <p className="truncate font-medium">{r.projectName}</p>
                    <p className="text-xs text-muted">
                      {r.projectCode} · {payoutStatusLabel[r.status]}
                    </p>
                  </Link>
                  <span className="text-right tabular-nums">
                    <span className="block font-medium">{formatMoney(r.remainingMinor, r.currency)}</span>
                    <span className="block text-xs text-muted">of {formatMoney(r.owedMinor, r.currency)}</span>
                  </span>
                </ListRow>
              ))}
            </List>
          )}
        </Card>
      </div>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  await Promise.all([refreshDeadlineAlertsQuietly(user), refreshRenewalAlertsQuietly(user)]);

  if (!can(user, "payout.viewAll")) return <MemberDashboard user={user} />;

  const [d, questionsWaiting, renewals] = await Promise.all([
    getDashboard(user, await searchParams),
    questionsWaitingOn(user),
    can(user, "subscription.view") ? listSubscriptions(user, { within: 60 }) : Promise.resolve(null),
  ]);
  const maxOutstanding = Math.max(1, ...d.outstandingByMember.map((m) => m.remainingMinor));
  const overdueCount = d.overdueProjects.length + d.overdueTasks.length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${firstName(user.name)}`}
        description="Money owed and paid, approvals waiting, and work that is running late."
        actions={
          <form className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs font-medium text-muted">
              <span className="block">Paid from</span>
              <input type="date" name="from" defaultValue={d.period.from} className={`${inputClass} w-auto py-1.5`} />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted">
              <span className="block">to</span>
              <input type="date" name="to" defaultValue={d.period.to} className={`${inputClass} w-auto py-1.5`} />
            </label>
            <button type="submit" className={buttonClass("secondary")}>
              Apply
            </button>
          </form>
        }
      />

      {questionsWaiting > 0 && (
        <Callout
          tone="warn"
          icon={Inbox}
          action={<ButtonLink href={`/questions?status=${user.role === "ADMIN" ? "" : "OPEN"}`} size="sm">Review</ButtonLink>}
        >
          {questionsWaiting} payout question{questionsWaiting === 1 ? " is" : "s are"} waiting for you.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total owed" value={formatMoney(d.totals.owedMinor)} icon={Wallet} href="/ledger" />
        <StatCard
          label="Paid in period"
          value={formatMoney(d.paidInPeriodMinor)}
          hint={`${formatCalendarDate(d.period.from)} – ${formatCalendarDate(d.period.to)}`}
          icon={Banknote}
          tone="good"
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(d.totals.remainingMinor)}
          icon={Hourglass}
          tone={d.totals.remainingMinor > 0 ? "warn" : "good"}
          href="/ledger?status=OWED"
        />
        <StatCard label="Awaiting approval" value={d.awaitingApproval.length} icon={Inbox} href="/projects?status=PENDING_APPROVAL" />
        <StatCard label="Overdue tasks" value={d.overdueTasks.length} icon={Clock} tone={d.overdueTasks.length ? "bad" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Outstanding by person" description="Approved but not yet paid" className="lg:col-span-2" aside={<ViewAll href="/ledger?status=OWED" />}>
          {d.outstandingByMember.length === 0 ? (
            <EmptyState icon={Wallet} title="Nothing outstanding">Everyone has been paid in full.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {d.outstandingByMember.map((m) => (
                <li key={m.name} className="flex items-center gap-3 text-sm">
                  <Avatar name={m.name} size="sm" />
                  <span className="w-40 shrink-0 truncate">{m.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(m.remainingMinor / maxOutstanding) * 100}%` }} />
                  </div>
                  <span className="w-32 shrink-0 text-right font-medium tabular-nums">{formatMoney(m.remainingMinor)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Awaiting approval" aside={<ViewAll href="/projects?status=PENDING_APPROVAL" />}>
          {d.awaitingApproval.length === 0 ? (
            <EmptyState icon={Inbox} title="Nothing to approve" />
          ) : (
            <List>
              {d.awaitingApproval.map((p) => (
                <ListRow key={p.id}>
                  <Link href={`/projects/${p.id}`} className="min-w-0 hover:text-brand-600">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted">{p.code}</p>
                  </Link>
                  <ArrowUpRight className="size-4 shrink-0 text-muted" aria-hidden />
                </ListRow>
              ))}
            </List>
          )}
        </Card>

        <Card title="Completed but not fully paid" aside={<ViewAll href="/ledger" />}>
          {d.completedNotFullyPaid.length === 0 ? (
            <EmptyState icon={Banknote} title="All completed projects are paid" />
          ) : (
            <List>
              {d.completedNotFullyPaid.map((p) => (
                <ListRow key={p.id}>
                  <Link href={`/ledger?projectId=${p.id}`} className="min-w-0 hover:text-brand-600">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted">{p.code}</p>
                  </Link>
                  <span className="font-medium tabular-nums">{formatMoney(p.remainingMinor)}</span>
                </ListRow>
              ))}
            </List>
          )}
        </Card>

        <Card
          title="Overdue work"
          aside={overdueCount > 0 ? <span className="text-xs font-medium text-red-600 dark:text-red-400">{overdueCount} late</span> : undefined}
        >
          {overdueCount === 0 ? (
            <EmptyState icon={Clock} title="Nothing overdue" />
          ) : (
            <List>
              {d.overdueProjects.map((p) => (
                <ListRow key={p.id}>
                  <Link href={`/projects/${p.id}`} className="min-w-0 hover:text-brand-600">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted">Project · {p.code}</p>
                  </Link>
                  <span className="shrink-0 text-xs text-red-600 dark:text-red-400">{formatCalendarDate(p.targetDate)}</span>
                </ListRow>
              ))}
              {d.overdueTasks.map((t) => (
                <ListRow key={t.id}>
                  <Link href={`/projects/${t.projectId}`} className="min-w-0 hover:text-brand-600">
                    <p className="truncate font-medium">{t.title}</p>
                    <p className="truncate text-xs text-muted">
                      {t.projectCode} · {t.assigneeName ?? "unassigned"}
                    </p>
                  </Link>
                  <span className="shrink-0 text-xs text-red-600 dark:text-red-400">{formatCalendarDate(t.dueDate)}</span>
                </ListRow>
              ))}
            </List>
          )}
        </Card>

        {renewals && (
          <Card
            title="Renewals"
            description="Next 60 days and anything overdue"
            aside={<ViewAll href="/subscriptions?within=60" />}
          >
            {renewals.length === 0 ? (
              <EmptyState icon={Repeat} title="No renewals coming up" />
            ) : (
              <List>
                {renewals.slice(0, 6).map((s) => (
                  <ListRow key={s.id}>
                    <Link href={`/subscriptions/${s.id}`} className="min-w-0 hover:text-brand-600">
                      <p className="truncate font-medium">{s.serviceName}</p>
                      <p className="truncate text-xs text-muted">
                        {s.customerName} · {formatCalendarDate(s.renewalDate ?? s.endDate)}
                      </p>
                    </Link>
                    <RenewalBadge renewal={s.renewal} />
                  </ListRow>
                ))}
              </List>
            )}
          </Card>
        )}

        <Card title="Payments and adjustments">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Partly paid</dt>
              <dd className="font-semibold tabular-nums">{d.partialPayments.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Internal owed</dt>
              <dd className="font-semibold tabular-nums">{formatMoney(d.clientTypeTotals.INTERNAL)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">External owed</dt>
              <dd className="font-semibold tabular-nums">{formatMoney(d.clientTypeTotals.EXTERNAL)}</dd>
            </div>
          </dl>
          {d.recentAdjustments.length > 0 && (
            <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              {d.recentAdjustments.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                  <span className="min-w-0">
                    <Link href={`/payouts/${a.ledgerEntryId}`} className="font-medium hover:text-brand-600">
                      {a.projectCode} · {a.memberName}
                    </Link>
                    <span className="text-muted">
                      {" "}
                      {adjustmentTypeLabel[a.type]} {a.type !== "VOID" && formatMoney(a.amountMinor)} · “{a.reason}”
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity" className="lg:col-span-3" aside={<ViewAll href="/audit" label="Audit log" />}>
          {d.recentActivity.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" />
          ) : (
            <ol className="space-y-3">
              {d.recentActivity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 text-sm">
                  <Avatar name={a.actorName ?? "System"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p>
                      <span className="font-medium">{a.actorName ?? "System"}</span>{" "}
                      <span className="text-muted">{describeAuditAction(a.action)}</span>
                      {a.projectCode && <span className="text-muted"> · {a.projectCode}</span>}
                    </p>
                    <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
