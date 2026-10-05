import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { HealthBadge } from "@/components/badges";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { describeAuditAction } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { addDays } from "@/modules/notifications/deadlines";
import { getWeeklySummary, summaryText } from "@/modules/reports/weekly";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}
const none = <p className="text-sm text-zinc-500">None.</p>;

export default async function WeeklySummaryPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "report.weekly")) return <AccessDenied what="the weekly summary" />;
  const s = await getWeeklySummary(actor, (await searchParams).week);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Weekly summary: {formatCalendarDate(s.start)} – {formatCalendarDate(s.end)}
          </h1>
          <p className="text-sm text-zinc-500">What moved this week, what is stuck now, and what is due next.</p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href={`/summary?week=${addDays(s.start, -7)}`} className="underline">
            ← Previous week
          </Link>
          {!s.isCurrentWeek && (
            <Link href={`/summary?week=${addDays(s.start, 7)}`} className="underline">
              Next week →
            </Link>
          )}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["Tasks completed", s.completed.length],
            ["Newly blocked", s.newlyBlocked.length],
            ["Blocked now", s.blockedNow.length],
            ["Overdue now", s.overdueNow.length],
            ["Paid this week", formatMoney(s.paidMinor)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Completed (${s.completed.length})`}>
          {s.completed.length === 0
            ? none
            : (
              <>
                <p className="text-sm text-zinc-500">{s.completedByPerson.map(([n, c]) => `${n}: ${c}`).join(" · ")}</p>
                <ul className="space-y-1 text-sm">
                  {s.completed.map((t) => (
                    <li key={t.id}>
                      {t.projectCode} · {t.title} <span className="text-zinc-500">({t.person ?? "Unassigned"})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </Panel>
        <Panel title="Approvals this week">
          {s.approvals.length === 0
            ? none
            : (
              <ul className="space-y-1 text-sm">
                {s.approvals.map((a, i) => (
                  <li key={i}>
                    <span className="text-zinc-500">{formatDateTime(a.at)}</span> · {a.projectCode} {describeAuditAction(a.action)}
                    {a.reason && <span className="text-zinc-500"> — “{a.reason}”</span>}
                  </li>
                ))}
              </ul>
            )}
          <p className="text-sm text-zinc-500">
            Payments: {formatMoney(s.paidMinor)} in {s.paymentCount} payment(s) · {s.adjustmentCount} adjustment(s)
          </p>
        </Panel>
        <Panel title={`Blocked now (${s.blockedNow.length})`}>
          {s.blockedNow.length === 0
            ? none
            : (
              <ul className="space-y-1 text-sm">
                {s.blockedNow.map((t) => (
                  <li key={t.id}>
                    {t.projectCode} · {t.title} <span className="text-zinc-500">({t.person ?? "Unassigned"}): {t.blockedReason}</span>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
        <Panel title={`Overdue now (${s.overdueNow.length})`}>
          {s.overdueNow.length === 0
            ? none
            : (
              <ul className="space-y-1 text-sm">
                {s.overdueNow.map((t) => (
                  <li key={t.id}>
                    {t.projectCode} · {t.title} <span className="text-red-600">due {formatCalendarDate(t.dueDate)}</span>{" "}
                    <span className="text-zinc-500">({t.person ?? "Unassigned"})</span>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
        <Panel title="Projects needing attention">
          {s.atRisk.length === 0
            ? none
            : (
              <ul className="space-y-1 text-sm">
                {s.atRisk.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/projects/${p.id}`} className="underline">
                      {p.code} {p.name}
                    </Link>
                    <HealthBadge health={p.health} />
                  </li>
                ))}
              </ul>
            )}
        </Panel>
        <Panel title={`Due in the next 7 days (${s.dueNext.length})`}>
          {s.dueNext.length === 0
            ? none
            : (
              <ul className="space-y-1 text-sm">
                {s.dueNext.map((t) => (
                  <li key={t.id}>
                    {formatCalendarDate(t.dueDate)} · {t.projectCode} · {t.title} <span className="text-zinc-500">({t.person ?? "Unassigned"})</span>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
      </div>

      <details className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <summary className="cursor-pointer font-medium">Plain text, to paste into WhatsApp, Slack or email</summary>
        <pre className="mt-3 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">{summaryText(s)}</pre>
      </details>
    </div>
  );
}
