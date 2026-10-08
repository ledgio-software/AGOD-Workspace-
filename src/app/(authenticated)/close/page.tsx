import Link from "next/link";
import { CalendarCheck, CircleCheck, Download, Inbox, Lock, LockOpen } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge, PayoutStatusBadge } from "@/components/badges";
import { inputClass } from "@/components/input-class";
import { Callout, Card, PageHeader, buttonClass, cx } from "@/components/ui";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { adjustmentTypeLabel, paymentMethodLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { currentPeriod, getPeriodClose, periodEnd, periodSchema, previousPeriod } from "@/modules/periods";
import { closePeriodAction, reopenPeriodAction } from "./actions";
import { ClosePeriodForm, ReopenPeriodForm } from "./close-forms";

function Step({
  n,
  title,
  children,
  aside,
  done,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  done?: boolean;
}) {
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2.5">
          <span
            className={cx(
              "grid size-6 place-items-center rounded-full text-xs font-semibold",
              done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
            )}
          >
            {done ? <CircleCheck className="size-3.5" aria-hidden /> : n}
          </span>
          {title}
        </span>
      }
      aside={aside}
    >
      {children}
    </Card>
  );
}
const none = <p className="text-sm text-muted">None.</p>;
const Row = ({ children }: { children: React.ReactNode }) => (
  <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-sm">{children}</li>
);

export default async function ClosePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "period.view")) return <AccessDenied what="the month close" />;
  const requested = (await searchParams).period;
  const period = periodSchema.safeParse(requested).success ? requested! : previousPeriod(currentPeriod());
  const c = await getPeriodClose(actor, period);
  const locked = c.state?.locked ?? false;
  const canClose = can(actor, "period.close");
  const warning = c.openQuestions.length ? `${c.openQuestions.length} payout question(s) are still unresolved.` : null;
  const monthName = new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Money"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            Month close: {monthName}
            <Badge tone={locked ? "green" : "gray"}>{locked ? "Closed" : "Open"}</Badge>
          </span>
        }
        description="Review the month, export it, then close it. A closed month refuses payments dated in it until an Admin reopens it with a reason."
        actions={
          <form className="flex items-end gap-2">
            <label className="space-y-1 text-xs font-medium text-muted">
              <span className="block">Month</span>
              <input type="month" name="period" defaultValue={period} className={`${inputClass} w-auto`} />
            </label>
            <button className={buttonClass("secondary")}>Show</button>
          </form>
        }
      />

      <Callout tone={locked ? "good" : "info"} icon={locked ? Lock : LockOpen}>
        {locked
          ? `Closed by ${c.state?.lockedByName ?? "an Admin"}${c.state?.lockedAt ? ` on ${formatDateTime(c.state.lockedAt)}` : ""}${c.state?.lockNote ? `: “${c.state.lockNote}”` : "."}`
          : c.state?.unlockedAt
            ? `Open. Reopened by ${c.state.unlockedByName ?? "an Admin"} on ${formatDateTime(c.state.unlockedAt)}: “${c.state.unlockReason}”.`
            : c.closable
              ? "Open. Not closed yet."
              : "This month has not finished yet, so it cannot be closed."}
      </Callout>

      {warning && (
        <Callout tone="warn" icon={Inbox} action={<Link href="/questions" className={buttonClass("secondary", "sm")}>Questions</Link>}>
          {warning} Settle them before closing.
        </Callout>
      )}

      <Step n={1} title={`Projects approved in ${period} (${c.approved.length})`}>
        {c.approved.length === 0 ? (
          none
        ) : (
          <ul className="-my-2.5 divide-y divide-line">
            {c.approved.map((p) => (
              <Row key={p.projectId}>
                <Link href={`/projects/${p.projectId}/statement`} className="min-w-0 hover:text-brand-600">
                  <span className="font-medium">{p.name}</span> <span className="font-mono text-xs text-muted">{p.code}</span>
                  <span className="block text-xs text-muted">approved {formatDateTime(new Date(p.approvedAt))}</span>
                </Link>
                <span className="font-medium tabular-nums">{formatMoney(p.owedMinor)}</span>
              </Row>
            ))}
          </ul>
        )}
      </Step>

      <Step
        n={2}
        title={`Outstanding balances (${c.outstanding.length})`}
        aside={<span className="text-sm font-semibold tabular-nums">{formatMoney(c.outstandingTotals.remainingMinor)} remaining</span>}
      >
        <p className="mb-3 text-sm text-muted">Payouts approved by the end of {period} that are not fully paid today.</p>
        {c.outstanding.length === 0 ? (
          none
        ) : (
          <ul className="-my-2.5 divide-y divide-line">
            {c.outstanding.map((r) => (
              <Row key={r.id}>
                <Link href={`/payouts/${r.id}`} className="min-w-0 hover:text-brand-600">
                  <span className="font-medium">{r.memberName}</span> <span className="font-mono text-xs text-muted">{r.projectCode}</span>
                </Link>
                <span className="inline-flex items-center gap-3">
                  <span className="tabular-nums">
                    <span className="font-medium">{formatMoney(r.remainingMinor, r.currency)}</span>
                    <span className="text-muted"> of {formatMoney(r.effectiveOwedMinor, r.currency)}</span>
                  </span>
                  <PayoutStatusBadge status={r.status} />
                </span>
              </Row>
            ))}
          </ul>
        )}
      </Step>

      <Step
        n={3}
        title={`Payments dated in ${period} (${c.payments.length})`}
        aside={<span className="text-sm font-semibold tabular-nums">{formatMoney(c.paymentsTotalMinor)}</span>}
      >
        {c.payments.length === 0 ? (
          none
        ) : (
          <ul className="-my-2.5 divide-y divide-line">
            {c.payments.map((p) => (
              <Row key={p.id}>
                <span className="min-w-0">
                  <span className="font-medium">{p.memberName}</span> <span className="font-mono text-xs text-muted">{p.projectCode}</span>
                  <span className="block text-xs text-muted">
                    {formatCalendarDate(p.paidAt.toISOString().slice(0, 10))} · {paymentMethodLabel[p.method]}
                    {p.reference ? ` · ref ${p.reference}` : <span className="text-amber-700 dark:text-amber-400"> · no reference</span>}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{formatMoney(p.amountMinor, p.currency)}</span>
              </Row>
            ))}
          </ul>
        )}
      </Step>

      <Step n={4} title={`Adjustments made in ${period} (${c.adjustments.length})`}>
        {c.adjustments.length === 0 ? (
          none
        ) : (
          <ul className="-my-2.5 divide-y divide-line">
            {c.adjustments.map((a) => (
              <Row key={a.id}>
                <span className="min-w-0">
                  <span className="font-medium">{a.memberName}</span> <span className="font-mono text-xs text-muted">{a.projectCode}</span>
                  <span className="block text-xs text-muted">
                    {formatDateTime(a.createdAt)} · “{a.reason}”
                  </span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <Badge tone={a.type === "INCREASE" ? "green" : a.type === "DECREASE" ? "amber" : "gray"}>{adjustmentTypeLabel[a.type]}</Badge>
                  {a.type !== "VOID" && <span className="tabular-nums">{formatMoney(a.amountMinor, a.currency)}</span>}
                </span>
              </Row>
            ))}
          </ul>
        )}
      </Step>

      <Step n={5} title="Export">
        <div className="flex flex-wrap gap-2">
          <a href={`/close/export?period=${period}`} className={buttonClass("secondary")}>
            <Download className="size-4" aria-hidden /> Download {period} payments and adjustments (CSV)
          </a>
          <a href={`/ledger/export?to=${periodEnd(period)}`} className={buttonClass("secondary")}>
            <Download className="size-4" aria-hidden /> Full ledger as of the end of {period} (CSV)
          </a>
        </div>
      </Step>

      <Step n={6} title={locked ? "Closed" : "Close the month"} done={locked}>
        {!canClose ? (
          <p className="text-sm text-muted">Only an Admin can close or reopen a month.</p>
        ) : locked ? (
          <ReopenPeriodForm action={reopenPeriodAction.bind(null, period)} period={period} />
        ) : c.closable ? (
          <ClosePeriodForm action={closePeriodAction.bind(null, period)} period={period} warning={warning} />
        ) : (
          <p className="text-sm text-muted">Come back after the month ends.</p>
        )}
      </Step>

      {c.history.length > 0 && (
        <Card title="Recent months" aside={<CalendarCheck className="size-4 text-muted" aria-hidden />}>
          <ul className="flex flex-wrap gap-2">
            {c.history.map((h) => (
              <li key={h.period}>
                <Link href={`/close?period=${h.period}`} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-muted">
                  {h.period}
                  <Badge tone={h.locked ? "green" : "amber"}>{h.locked ? "closed" : "reopened"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
