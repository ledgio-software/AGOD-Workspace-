import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { adjustmentTypeLabel, paymentMethodLabel, payoutStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { currentPeriod, getPeriodClose, periodEnd, periodSchema, previousPeriod } from "@/modules/periods";
import { closePeriodAction, reopenPeriodAction } from "./actions";
import { ClosePeriodForm, ReopenPeriodForm } from "./close-forms";

function Step({ n, title, children, aside }: { n: number; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          {n}. {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
const none = <p className="text-sm text-zinc-500">None.</p>;

export default async function ClosePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "period.view")) return <AccessDenied what="the month close" />;
  const requested = (await searchParams).period;
  const period = periodSchema.safeParse(requested).success ? requested! : previousPeriod(currentPeriod());
  const c = await getPeriodClose(actor, period);
  const locked = c.state?.locked ?? false;
  const canClose = can(actor, "period.close");
  const warning = c.openQuestions.length ? `${c.openQuestions.length} payout question(s) are still unresolved.` : null;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Month close: {period}</h1>
          <p className="text-sm text-zinc-500">
            Review the month, export it, then close it. A closed month refuses payments dated in it until an Admin reopens it with a reason.
          </p>
        </div>
        <form className="flex items-end gap-2 text-sm">
          <label className="space-y-1">
            <span className="block text-zinc-500">Month</span>
            <input type="month" name="period" defaultValue={period} className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
          </label>
          <button className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700">Show</button>
        </form>
      </div>

      <p
        className={`rounded-md p-3 text-sm ${locked ? "bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-200" : "bg-zinc-50 dark:bg-zinc-900"}`}
      >
        {locked
          ? `Closed by ${c.state?.lockedByName ?? "an Admin"}${c.state?.lockedAt ? ` on ${formatDateTime(c.state.lockedAt)}` : ""}${c.state?.lockNote ? `: “${c.state.lockNote}”` : "."}`
          : c.state?.unlockedAt
            ? `Open. Reopened by ${c.state.unlockedByName ?? "an Admin"} on ${formatDateTime(c.state.unlockedAt)}: “${c.state.unlockReason}”.`
            : c.closable
              ? "Open. Not closed yet."
              : "This month has not finished yet, so it cannot be closed."}
      </p>

      {warning && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {warning} Settle them on the{" "}
          <Link href="/questions" className="underline">
            Questions
          </Link>{" "}
          page before closing.
        </p>
      )}

      <Step n={1} title={`Projects approved in ${period} (${c.approved.length})`}>
        {c.approved.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {c.approved.map((p) => (
                <li key={p.projectId}>
                  <Link href={`/projects/${p.projectId}/statement`} className="underline">
                    {p.code} {p.name}
                  </Link>{" "}
                  · approved {formatDateTime(new Date(p.approvedAt))} · payouts {formatMoney(p.owedMinor)}
                </li>
              ))}
            </ul>
          )}
      </Step>

      <Step n={2} title={`Outstanding balances (${c.outstanding.length})`} aside={<span className="text-sm tabular-nums">{formatMoney(c.outstandingTotals.remainingMinor)} remaining</span>}>
        <p className="text-sm text-zinc-500">Payouts approved by the end of {period} that are not fully paid today.</p>
        {c.outstanding.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {c.outstanding.map((r) => (
                <li key={r.id}>
                  <Link href={`/payouts/${r.id}`} className="underline">
                    {r.projectCode} · {r.memberName}
                  </Link>{" "}
                  · {formatMoney(r.remainingMinor, r.currency)} of {formatMoney(r.effectiveOwedMinor, r.currency)} · {payoutStatusLabel[r.status]}
                </li>
              ))}
            </ul>
          )}
      </Step>

      <Step n={3} title={`Payments dated in ${period} (${c.payments.length})`} aside={<span className="text-sm tabular-nums">{formatMoney(c.paymentsTotalMinor)}</span>}>
        {c.payments.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {c.payments.map((p) => (
                <li key={p.id}>
                  {formatCalendarDate(p.paidAt.toISOString().slice(0, 10))} · {p.projectCode} · {p.memberName} ·{" "}
                  <strong>{formatMoney(p.amountMinor, p.currency)}</strong> · {paymentMethodLabel[p.method]}
                  {p.reference ? ` · ref ${p.reference}` : <span className="text-amber-700"> · no reference</span>}
                </li>
              ))}
            </ul>
          )}
      </Step>

      <Step n={4} title={`Adjustments made in ${period} (${c.adjustments.length})`}>
        {c.adjustments.length === 0
          ? none
          : (
            <ul className="space-y-1 text-sm">
              {c.adjustments.map((a) => (
                <li key={a.id}>
                  {formatDateTime(a.createdAt)} · {a.projectCode} · {a.memberName} · {adjustmentTypeLabel[a.type]}
                  {a.type !== "VOID" && ` ${formatMoney(a.amountMinor, a.currency)}`} · “{a.reason}”
                </li>
              ))}
            </ul>
          )}
      </Step>

      <Step n={5} title="Export">
        <p className="text-sm">
          <a href={`/close/export?period=${period}`} className="underline">
            Download {period} payments and adjustments (CSV)
          </a>{" "}
          ·{" "}
          <a href={`/ledger/export?to=${periodEnd(period)}`} className="underline">
            Full ledger as of the end of {period} (CSV)
          </a>
        </p>
      </Step>

      <Step n={6} title={locked ? "Closed" : "Close the month"}>
        {!canClose ? (
          <p className="text-sm text-zinc-500">Only an Admin can close or reopen a month.</p>
        ) : locked ? (
          <ReopenPeriodForm action={reopenPeriodAction.bind(null, period)} period={period} />
        ) : c.closable ? (
          <ClosePeriodForm action={closePeriodAction.bind(null, period)} period={period} warning={warning} />
        ) : (
          <p className="text-sm text-zinc-500">Come back after the month ends.</p>
        )}
      </Step>

      {c.history.length > 0 && (
        <p className="text-sm text-zinc-500">
          Recent months:{" "}
          {c.history.map((h, i) => (
            <span key={h.period}>
              {i > 0 && " · "}
              <Link href={`/close?period=${h.period}`} className="underline">
                {h.period}
              </Link>{" "}
              {h.locked ? "closed" : "reopened"}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
