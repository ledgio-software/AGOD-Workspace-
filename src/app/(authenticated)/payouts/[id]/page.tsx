import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Banknote, CircleHelp, Scale } from "lucide-react";
import { Badge, PayoutStatusBadge, QuestionStatusBadge } from "@/components/badges";
import { FileList, FileUploadForm } from "@/components/files";
import { Avatar, Card, EmptyState, cx } from "@/components/ui";
import { formatCalendarDate, formatDateTime, todayInOperatingZone } from "@/lib/dates";
import { adjustmentTypeLabel, paymentMethodLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getPayout } from "@/modules/payments";
import { questionsForPayout } from "@/modules/questions";
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
  const [questions, receipts] = await Promise.all([
    questionsForPayout(actor, entry.id),
    listPaymentReceipts(actor, payout.payments.map((p) => p.id)),
  ]);
  const canAttachReceipt = can(actor, "payment.record") && (await attachmentsAvailable(actor.orgId));
  const isOwn = entry.memberId === actor.id;
  const money = (m: number) => formatMoney(m, entry.currency);
  const paidShare = balance.effectiveOwedMinor > 0 ? Math.min(100, Math.round((balance.paidMinor / balance.effectiveOwedMinor) * 100)) : 0;
  const back = can(actor, "payout.viewAll") ? { href: "/ledger", label: "Ledger" } : { href: "/my-work", label: "My work" };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {back.label}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={payout.memberName} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Payout to {payout.memberName}</h1>
              <PayoutStatusBadge status={balance.status} />
            </div>
            <p className="text-sm text-muted">
              <Link href={`/projects/${entry.projectId}`} className="hover:text-fg">
                <span className="font-mono text-xs">{payout.projectCode}</span> {payout.projectName}
              </Link>{" "}
              · approved {formatDateTime(entry.approvedAt)}
            </p>
          </div>
        </div>
      </div>
      {entry.notes && <p className="text-sm text-muted">{entry.notes}</p>}

      <Card>
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(
              [
                ["Original", balance.originalMinor, ""],
                ["Adjustments", balance.adjustmentsMinor, balance.adjustmentsMinor ? "" : "text-muted"],
                ["Owed", balance.effectiveOwedMinor, ""],
                ["Paid", balance.paidMinor, "text-emerald-700 dark:text-emerald-400"],
                ["Remaining", balance.remainingMinor, balance.remainingMinor > 0 ? "text-amber-700 dark:text-amber-400" : ""],
              ] as const
            ).map(([label, value, tone]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className={cx("text-lg font-semibold tabular-nums", tone)}>{money(value)}</dd>
              </div>
            ))}
          </dl>
          {open && balance.effectiveOwedMinor > 0 && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`${paidShare}% paid`}>
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidShare}%` }} />
              </div>
              <p className="text-xs text-muted">{paidShare}% paid</p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Payments" aside={<Banknote className="size-4 text-muted" aria-hidden />}>
          <div className="space-y-4">
            {payout.payments.length === 0 ? (
              <EmptyState icon={Banknote} title="No payments recorded yet" />
            ) : (
              <ul className="-my-2 divide-y divide-line">
                {payout.payments.map((p) => (
                  <li key={p.id} className="space-y-1.5 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold tabular-nums">{formatMoney(p.amountMinor, p.currency)}</span>
                      <span className="text-xs text-muted">{formatCalendarDate(p.paidAt.toISOString().slice(0, 10))}</span>
                    </div>
                    <p className="text-xs text-muted">
                      {paymentMethodLabel[p.method]}
                      {p.reference && ` · ref ${p.reference}`} · recorded by {p.recordedByName}
                      {p.notes && ` · ${p.notes}`}
                      {p.evidenceFilePath && (
                        <>
                          {" · "}
                          <a href={p.evidenceFilePath} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                            evidence
                          </a>
                        </>
                      )}
                    </p>
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
                        <summary className="cursor-pointer text-muted hover:text-fg">Attach a receipt</summary>
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
              <div className="border-t border-line pt-4">
                <PaymentForm action={recordPaymentAction.bind(null, entry.id)} today={todayInOperatingZone()} remainingLabel={money(balance.remainingMinor)} />
              </div>
            )}
          </div>
        </Card>

        <Card title="Adjustments" aside={<Scale className="size-4 text-muted" aria-hidden />}>
          <div className="space-y-4">
            {payout.adjustments.length === 0 ? (
              <EmptyState icon={Scale} title="No adjustments">
                The approved amount stands.
              </EmptyState>
            ) : (
              <ul className="-my-2 divide-y divide-line">
                {payout.adjustments.map((a) => (
                  <li key={a.id} className="space-y-1 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <Badge tone={a.type === "INCREASE" ? "green" : a.type === "DECREASE" ? "amber" : "gray"}>{adjustmentTypeLabel[a.type]}</Badge>
                      {a.type !== "VOID" && (
                        <span className="font-semibold tabular-nums">
                          {a.type === "INCREASE" ? "+" : "−"}
                          {money(a.amountMinor)}
                        </span>
                      )}
                    </div>
                    <p>“{a.reason}”</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(a.createdAt)} · by {a.createdByName}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {can(actor, "adjustment.create") && open && (
              <div className="border-t border-line pt-4">
                <AdjustmentForm action={createAdjustmentAction.bind(null, entry.id)} />
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card id="questions" title="Questions" aside={<CircleHelp className="size-4 text-muted" aria-hidden />}>
        <div className="space-y-4">
          {questions.length === 0 && (
            <EmptyState icon={CircleHelp} title="No questions about this payout">
              {isOwn && open ? "If something looks wrong, ask below. Asking never changes the amount." : undefined}
            </EmptyState>
          )}
          <ul className="space-y-4">
            {questions.map((q) => (
              <li key={q.id} className="space-y-3 rounded-lg border border-line p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-2">
                    <Avatar name={q.raisedByName} size="sm" />
                    <span className="font-medium">{q.raisedByName}</span>
                    <span className="text-xs text-muted">{formatDateTime(q.createdAt)}</span>
                  </p>
                  <QuestionStatusBadge status={q.status} />
                </div>
                <p className="whitespace-pre-line rounded-lg bg-surface-muted px-3 py-2">“{q.question}”</p>
                {q.reviewNote && (
                  <p className="text-muted">
                    <span className="font-medium text-fg">Review by {q.reviewedByName}:</span> {q.reviewNote}
                  </p>
                )}
                {q.status === "RESOLVED" && (
                  <p className="text-muted">
                    <span className="font-medium text-fg">Resolved by {q.resolvedByName}</span>
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
          {isOwn && open && (
            <div className="border-t border-line pt-4">
              <QuestionForm action={raiseQuestionAction.bind(null, entry.id)} />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
