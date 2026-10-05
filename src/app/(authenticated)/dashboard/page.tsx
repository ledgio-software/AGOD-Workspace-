import Link from "next/link";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { adjustmentTypeLabel, describeAuditAction } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getDashboard } from "@/modules/reports";
import { getMyWork } from "@/modules/work";

function Stat({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </>
  );
  const cls = "block rounded-lg border border-zinc-200 p-3 dark:border-zinc-800";
  return href ? (
    <Link href={href} className={`${cls} hover:border-zinc-400`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const empty = <p className="text-sm text-zinc-500">None.</p>;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();

  if (!can(user, "payout.viewAll")) {
    const work = await getMyWork(user);
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open tasks" value={work.summary.assigned - work.summary.completed} href="/my-work" />
          <Stat label="Overdue" value={work.summary.overdue} href="/my-work" />
          <Stat label="Owed to you" value={formatMoney(work.payouts.owedMinor)} href="/my-work" />
          <Stat label="Remaining" value={formatMoney(work.payouts.remainingMinor)} href="/my-work" />
        </div>
        <p className="text-sm text-zinc-500">
          Details are on <Link href="/my-work" className="underline">My work</Link>.
        </p>
      </div>
    );
  }

  const d = await getDashboard(user, await searchParams);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <form className="flex items-end gap-2 text-xs text-zinc-500">
          <label>
            Paid from
            <input type="date" name="from" defaultValue={d.period.from} className="block rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" />
          </label>
          <label>
            to
            <input type="date" name="to" defaultValue={d.period.to} className="block rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" />
          </label>
          <button type="submit" className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700">
            Apply
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Total owed" value={formatMoney(d.totals.owedMinor)} href="/ledger" />
        <Stat label={`Paid ${formatCalendarDate(d.period.from)} – ${formatCalendarDate(d.period.to)}`} value={formatMoney(d.paidInPeriodMinor)} />
        <Stat label="Outstanding" value={formatMoney(d.totals.remainingMinor)} href="/ledger?status=OWED" />
        <Stat label="Awaiting approval" value={d.awaitingApproval.length} href="/projects?status=PENDING_APPROVAL" />
        <Stat label="Overdue tasks" value={d.overdueTasks.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Outstanding by person">
          {d.outstandingByMember.length === 0
            ? empty
            : (
              <ul className="space-y-1 text-sm">
                {d.outstandingByMember.map((m) => (
                  <li key={m.name} className="flex justify-between">
                    <span>{m.name}</span>
                    <span className="tabular-nums">{formatMoney(m.remainingMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Panel>

        <Panel title="Completed but not fully paid">
          {d.completedNotFullyPaid.length === 0
            ? empty
            : (
              <ul className="space-y-1 text-sm">
                {d.completedNotFullyPaid.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <Link href={`/ledger?projectId=${p.id}`} className="hover:underline">
                      {p.code} {p.name}
                    </Link>
                    <span className="tabular-nums">{formatMoney(p.remainingMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Panel>

        <Panel title="Awaiting approval">
          {d.awaitingApproval.length === 0
            ? empty
            : (
              <ul className="space-y-1 text-sm">
                {d.awaitingApproval.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="hover:underline">
                      {p.code} {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </Panel>

        <Panel title="Overdue work">
          {d.overdueProjects.length === 0 && d.overdueTasks.length === 0
            ? empty
            : (
              <ul className="space-y-1 text-sm">
                {d.overdueProjects.map((p) => (
                  <li key={p.id}>
                    Project{" "}
                    <Link href={`/projects/${p.id}`} className="hover:underline">
                      {p.code} {p.name}
                    </Link>{" "}
                    <span className="text-red-600">target {formatCalendarDate(p.targetDate)}</span>
                  </li>
                ))}
                {d.overdueTasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/projects/${t.projectId}`} className="hover:underline">
                      {t.projectCode}
                    </Link>{" "}
                    {t.title} · {t.assigneeName ?? "unassigned"} <span className="text-red-600">due {formatCalendarDate(t.dueDate)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Panel>

        <Panel title="Partial payments and adjustments">
          <p className="text-sm">
            {d.partialPayments.length} payout(s) partially paid. Internal projects owe {formatMoney(d.clientTypeTotals.INTERNAL)},
            external {formatMoney(d.clientTypeTotals.EXTERNAL)}.
          </p>
          {d.recentAdjustments.length > 0 && (
            <ul className="space-y-1 text-sm">
              {d.recentAdjustments.map((a) => (
                <li key={a.id}>
                  <Link href={`/payouts/${a.ledgerEntryId}`} className="hover:underline">
                    {a.projectCode} · {a.memberName}
                  </Link>
                  : {adjustmentTypeLabel[a.type]} {a.type !== "VOID" && formatMoney(a.amountMinor)} · “{a.reason}”
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity">
          <ul className="space-y-1 text-sm">
            {d.recentActivity.map((a) => (
              <li key={a.id}>
                <span className="text-zinc-500">{formatDateTime(a.createdAt)}</span> · <strong>{a.actorName ?? "System"}</strong>{" "}
                {describeAuditAction(a.action)}
                {a.projectCode && <span className="text-zinc-500"> ({a.projectCode})</span>}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
