import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCalendarDate, formatDateTime, todayInOperatingZone } from "@/lib/dates";
import { adjustmentTypeLabel, paymentMethodLabel, payoutQuestionStatusLabel, payoutStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getPayout } from "@/modules/payments";
import { questionsForPayout } from "@/modules/questions";
import { FileList, FileUploadForm } from "@/components/files";
import { attachmentsAvailable, listPaymentReceipts } from "@/modules/attachments";
import { createAdjustmentAction, raiseQuestionAction, recordPaymentAction, resolveQuestionAction, reviewQuestionAction, uploadReceiptAction } from "../actions";
import { AdjustmentForm, PaymentForm, QuestionForm, ResolveQuestionForm, ReviewQuestionForm } from "./payout-forms";

export default async function PayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const payout = await getPayout(actor, id);
  if (!payout) notFound();
  const { entry, balance } = payout;
  const open = balance.status !== "VOIDED";
  const questions = await questionsForPayout(actor, entry.id);
  const receipts = await listPaymentReceipts(actor, payout.payments.map((p) => p.id));
  const canAttachReceipt = can(actor, "payment.record") && attachmentsAvailable();
  const isOwn = entry.memberId === actor.id;

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
                <FileList
                  files={(receipts.get(p.id) ?? []).map((f) => ({
                    id: f.id,
                    fileName: f.fileName,
                    sizeBytes: f.sizeBytes,
                    uploaderName: f.uploaderName,
                    createdAt: formatDateTime(f.createdAt),
                  }))}
                />
                {canAttachReceipt && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-zinc-500">Attach a receipt</summary>
                    <div className="mt-2">
                      <FileUploadForm action={uploadReceiptAction.bind(null, entry.id, p.id)} label="Attach receipt" />
                    </div>
                  </details>
                )}
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

      <section id="questions" className="space-y-3">
        <h2 className="font-semibold">Questions</h2>
        {questions.length === 0 && <p className="text-sm text-zinc-500">No questions about this payout.</p>}
        <ul className="space-y-3">
          {questions.map((q) => (
            <li key={q.id} className="space-y-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <p>
                <strong>{q.raisedByName}</strong> asked on {formatDateTime(q.createdAt)} ·{" "}
                <span className="text-zinc-500">{payoutQuestionStatusLabel[q.status]}</span>
              </p>
              <p>“{q.question}”</p>
              {q.reviewNote && (
                <p className="text-zinc-600 dark:text-zinc-400">
                  Review by {q.reviewedByName}: {q.reviewNote}
                </p>
              )}
              {q.status === "RESOLVED" && (
                <p className="text-zinc-600 dark:text-zinc-400">
                  Resolved by {q.resolvedByName}
                  {q.resolvedAt && <> on {formatDateTime(q.resolvedAt)}</>}: {q.resolution}
                  {q.adjustmentId && " (adjustment recorded above)"}
                </p>
              )}
              {q.status === "OPEN" && can(actor, "payoutQuestion.review") && (q.raisedBy !== actor.id || actor.role === "ADMIN") && (
                <ReviewQuestionForm action={reviewQuestionAction.bind(null, q.id, entry.id)} />
              )}
              {q.status !== "RESOLVED" && can(actor, "payoutQuestion.resolve") && open && (
                <ResolveQuestionForm action={resolveQuestionAction.bind(null, q.id, entry.id)} />
              )}
            </li>
          ))}
        </ul>
        {isOwn && open && <QuestionForm action={raiseQuestionAction.bind(null, entry.id)} />}
      </section>
    </div>
  );
}
