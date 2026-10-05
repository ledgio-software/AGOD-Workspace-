import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCalendarDate, formatDateTime, todayInOperatingZone } from "@/lib/dates";
import { adjustmentTypeLabel, paymentMethodLabel, payoutStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getPayout } from "@/modules/payments";
import { createAdjustmentAction, recordPaymentAction } from "../actions";
import { AdjustmentForm, PaymentForm } from "./payout-forms";

export default async function PayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const payout = await getPayout(actor, id);
  if (!payout) notFound();
  const { entry, balance } = payout;
  const open = balance.status !== "VOIDED";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={can(actor, "payout.viewAll") ? "/ledger" : "/my-work"} className="text-sm text-zinc-500 hover:underline">
          ← {can(actor, "payout.viewAll") ? "Ledger" : "My work"}
        </Link>
        <h1 className="text-xl font-semibold">
          Payout to {payout.memberName} · {payoutStatusLabel[balance.status]}
        </h1>
        <p className="text-sm text-zinc-500">
          <Link href={`/projects/${entry.projectId}`} className="hover:underline">
            {payout.projectCode} {payout.projectName}
          </Link>{" "}
          · approved {formatDateTime(entry.approvedAt)}
        </p>
        {entry.notes && <p className="mt-1 text-sm text-zinc-500">{entry.notes}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {[
          ["Original", balance.originalMinor],
          ["Adjustments", balance.adjustmentsMinor],
          ["Owed", balance.effectiveOwedMinor],
          ["Paid", balance.paidMinor],
          ["Remaining", balance.remainingMinor],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(value as number, entry.currency)}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3">
        <h2 className="font-semibold">Payments</h2>
        {payout.payments.length === 0 ? (
          <p className="text-sm text-zinc-500">No payments recorded yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {payout.payments.map((p) => (
              <li key={p.id}>
                {formatCalendarDate(p.paidAt.toISOString().slice(0, 10))} · <strong>{formatMoney(p.amountMinor, p.currency)}</strong> ·{" "}
                {paymentMethodLabel[p.method]}
                {p.reference && ` · ref ${p.reference}`}
                {p.evidenceFilePath && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={p.evidenceFilePath} target="_blank" rel="noopener noreferrer" className="underline">
                      evidence
                    </a>
                  </>
                )}
                <span className="text-zinc-500"> · recorded by {p.recordedByName}</span>
                {p.notes && <span className="text-zinc-500"> · {p.notes}</span>}
              </li>
            ))}
          </ul>
        )}
        {can(actor, "payment.record") && open && balance.remainingMinor > 0 && (
          <PaymentForm
            action={recordPaymentAction.bind(null, entry.id)}
            today={todayInOperatingZone()}
            remainingLabel={formatMoney(balance.remainingMinor, entry.currency)}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Adjustments</h2>
        {payout.adjustments.length === 0 ? (
          <p className="text-sm text-zinc-500">No adjustments. The approved amount stands.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {payout.adjustments.map((a) => (
              <li key={a.id}>
                {formatDateTime(a.createdAt)} · <strong>{adjustmentTypeLabel[a.type]}</strong>
                {a.type !== "VOID" && ` ${formatMoney(a.amountMinor, entry.currency)}`} · “{a.reason}”
                <span className="text-zinc-500"> · by {a.createdByName}</span>
              </li>
            ))}
          </ul>
        )}
        {can(actor, "adjustment.create") && open && <AdjustmentForm action={createAdjustmentAction.bind(null, entry.id)} />}
      </section>
    </div>
  );
}
