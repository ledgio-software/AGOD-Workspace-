import Link from "next/link";
import { Banknote, ChevronLeft, ChevronRight, CircleCheck, CircleSlash, Clock, Copy } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { HealthBadge } from "@/components/badges";
import { Card, Disclosure, PageHeader, StatCard, buttonClass } from "@/components/ui";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { describeAuditAction } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { addDays } from "@/modules/notifications/deadlines";
import { getWeeklySummary, summaryText } from "@/modules/reports/weekly";

const none = <p className="text-sm text-muted">None.</p>;
const Item = ({ children }: { children: React.ReactNode }) => <li className="py-2.5 text-sm">{children}</li>;
const Who = ({ name }: { name: string | null }) => <span className="text-muted"> · {name ?? "Unassigned"}</span>;

export default async function WeeklySummaryPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "report.weekly")) return <AccessDenied what="the weekly summary" />;
  const s = await getWeeklySummary(actor, (await searchParams).week);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Weekly summary"
        title={`${formatCalendarDate(s.start)} – ${formatCalendarDate(s.end)}`}
        description="What moved this week, what is stuck now, and what is due next."
        actions={
          <>
            <Link href={`/summary?week=${addDays(s.start, -7)}`} className={buttonClass("secondary")}>
              <ChevronLeft className="size-4" aria-hidden /> Previous week
            </Link>
            {!s.isCurrentWeek && (
              <Link href={`/summary?week=${addDays(s.start, 7)}`} className={buttonClass("secondary")}>
                Next week <ChevronRight className="size-4" aria-hidden />
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Tasks completed" value={s.completed.length} icon={CircleCheck} tone="good" />
        <StatCard label="Newly blocked" value={s.newlyBlocked.length} icon={CircleSlash} tone={s.newlyBlocked.length ? "bad" : "default"} />
        <StatCard label="Blocked now" value={s.blockedNow.length} icon={CircleSlash} tone={s.blockedNow.length ? "bad" : "default"} />
        <StatCard label="Overdue now" value={s.overdueNow.length} icon={Clock} tone={s.overdueNow.length ? "warn" : "default"} />
        <StatCard label="Paid this week" value={formatMoney(s.paidMinor)} icon={Banknote} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Completed (${s.completed.length})`} description={s.completedByPerson.map(([n, c]) => `${n}: ${c}`).join(" · ") || undefined}>
          {s.completed.length === 0 ? (
            none
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {s.completed.map((t) => (
                <Item key={t.id}>
                  <span className="font-mono text-xs text-muted">{t.projectCode}</span> {t.title}
                  <Who name={t.person} />
                </Item>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Approvals this week" description={`Payments: ${formatMoney(s.paidMinor)} in ${s.paymentCount} payment(s) · ${s.adjustmentCount} adjustment(s)`}>
          {s.approvals.length === 0 ? (
            none
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {s.approvals.map((a, i) => (
                <Item key={i}>
                  <span className="font-mono text-xs text-muted">{a.projectCode}</span> {describeAuditAction(a.action)}
                  {a.reason && <span className="text-muted"> — “{a.reason}”</span>}
                  <span className="block text-xs text-muted">{formatDateTime(a.at)}</span>
                </Item>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Blocked now (${s.blockedNow.length})`}>
          {s.blockedNow.length === 0 ? (
            none
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {s.blockedNow.map((t) => (
                <Item key={t.id}>
                  <span className="font-mono text-xs text-muted">{t.projectCode}</span> {t.title}
                  <Who name={t.person} />
                  <span className="block text-xs text-red-700 dark:text-red-400">{t.blockedReason}</span>
                </Item>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Overdue now (${s.overdueNow.length})`}>
          {s.overdueNow.length === 0 ? (
            none
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {s.overdueNow.map((t) => (
                <Item key={t.id}>
                  <span className="font-mono text-xs text-muted">{t.projectCode}</span> {t.title}
                  <Who name={t.person} />
                  <span className="block text-xs text-red-600 dark:text-red-400">due {formatCalendarDate(t.dueDate)}</span>
                </Item>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Projects needing attention">
          {s.atRisk.length === 0 ? (
            none
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {s.atRisk.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/projects/${p.id}`} className="min-w-0 hover:text-brand-600">
                    <span className="font-medium">{p.name}</span> <span className="font-mono text-xs text-muted">{p.code}</span>
                  </Link>
                  <HealthBadge health={p.health} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Due in the next 7 days (${s.dueNext.length})`}>
          {s.dueNext.length === 0 ? (
            none
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {s.dueNext.map((t) => (
                <Item key={t.id}>
                  <span className="font-mono text-xs text-muted">{t.projectCode}</span> {t.title}
                  <Who name={t.person} />
                  <span className="block text-xs text-muted">due {formatCalendarDate(t.dueDate)}</span>
                </Item>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Disclosure
        className="bg-surface shadow-xs"
        summary={
          <span className="inline-flex items-center gap-2">
            <Copy className="size-4 text-brand-600" aria-hidden /> Plain text, to paste into WhatsApp, Slack or email
          </span>
        }
      >
        <pre className="select-all whitespace-pre-wrap rounded-lg bg-surface-muted p-4 text-sm">{summaryText(s)}</pre>
      </Disclosure>
    </div>
  );
}
