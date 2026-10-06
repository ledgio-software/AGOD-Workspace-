import Link from "next/link";
import { CircleCheck, FileText, Wallet } from "lucide-react";
import { Badge } from "@/components/badges";
import { Callout, Card, EmptyState, cx, table } from "@/components/ui";
import { formatCalendarDate, todayInOperatingZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { type Actor, can } from "@/lib/permissions";
import { type StageStatus, PRESETS, getBilling } from "@/modules/billing";
import { isEditable } from "@/modules/projects/rules";
import {
  addStageAction,
  createChangeAction,
  decideChangeAction,
  invoiceStageAction,
  presetAction,
  removeStageAction,
  reviewAction,
  sendChangeAction,
  signOffAction,
} from "./billing-actions";
import { AddStageForm, ButtonForm, ChangeRequestForm, DecideForm, PresetForm, ReviewForm, SignOffForm } from "./billing-forms";

// Phase 29: the Billing tab of a client project: payment plan, client sign-off, change requests.

type Billing = NonNullable<Awaited<ReturnType<typeof getBilling>>>;

const statusBadge: Record<StageStatus, { label: string; tone: "gray" | "blue" | "amber" | "green" }> = {
  NOT_INVOICED: { label: "Not invoiced", tone: "gray" },
  DRAFT: { label: "Draft invoice", tone: "gray" },
  INVOICED: { label: "Invoiced", tone: "blue" },
  PART_PAID: { label: "Part paid", tone: "amber" },
  PAID: { label: "Paid", tone: "green" },
};

const kindLabel = { DEPOSIT: "Deposit", MILESTONE: "Milestone", FINAL: "Final", CHANGE: "Change" } as const;
const changeTone = { DRAFT: "gray", SENT: "blue", APPROVED: "green", REJECTED: "red" } as const;
const changeLabel = { DRAFT: "Draft", SENT: "With the client", APPROVED: "Approved", REJECTED: "Rejected" } as const;

export function BillingTab({ actor, billing, milestones }: { actor: Actor; billing: Billing; milestones: { id: string; title: string }[] }) {
  const { project, stages, changes, settings } = billing;
  const canEdit = can(actor, "project.edit") && project.status !== "CANCELLED";
  const canInvoice = can(actor, "invoice.manage");
  const today = todayInOperatingZone();
  const deposit = stages.find((s) => s.kind === "DEPOSIT");
  const open = (s: (typeof stages)[number]) => s.status === "NOT_INVOICED";

  return (
    <div className="space-y-6">
      {settings.requireDeposit && project.status === "PLANNING" && (!deposit || deposit.status !== "PAID") && (
        <Callout tone="warn" icon={Wallet}>
          This company starts client work only after the deposit is paid.{" "}
          {deposit ? `The deposit (${formatMoney(deposit.amountMinor)}) isn't paid yet.` : "Add a deposit to the payment plan."}
        </Callout>
      )}
      {!project.customerId && (
        <Callout tone="warn" icon={FileText}>
          This project isn&apos;t linked to a customer yet, so its payments can&apos;t be invoiced. Choose the customer in the project details (Overview).
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Project value", formatMoney(project.totalValueMinor)],
          ["In the payment plan", formatMoney(billing.plannedMinor)],
          ["Paid by the client", formatMoney(billing.clientPaidMinor)],
          ["Still to plan", formatMoney(billing.unplannedMinor)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface p-4 shadow-xs">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <Card title="Payment plan" description="How and when the client pays. Each payment gets its own invoice; its status follows the invoice." bodyClassName="p-0">
        {stages.length === 0 ? (
          <div className="space-y-3 p-5">
            <EmptyState icon={Wallet} title="No payment plan yet">
              {canEdit ? "Start from a common plan, then adjust it." : "A project manager sets this up."}
            </EmptyState>
            {canEdit && <PresetForm action={presetAction.bind(null, project.id)} presets={Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label }))} replacing={false} />}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Payment</th>
                  <th className={cx(table.th, "text-right")}>Amount</th>
                  <th className={table.th}>Invoice</th>
                  <th className={table.th}>Client sign-off</th>
                  {(canEdit || canInvoice) && <th className={cx(table.th, "text-right")}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr key={s.id} className={cx(table.row, "align-top")}>
                    <td className={table.td}>
                      <span className="font-medium">{s.label}</span>
                      <span className="block text-xs text-muted">
                        {kindLabel[s.kind]}
                        {s.milestoneTitle ? ` · ${s.milestoneTitle}` : ""}
                      </span>
                    </td>
                    <td className={cx(table.td, "text-right tabular-nums")}>
                      {formatMoney(s.amountMinor)}
                      {s.status === "PART_PAID" && <span className="block text-xs text-muted">{formatMoney(s.paidMinor)} paid</span>}
                    </td>
                    <td className={table.td}>
                      <Badge tone={statusBadge[s.status].tone}>{statusBadge[s.status].label}</Badge>
                      {s.invoiceId && (
                        <Link href={`/invoices/${s.invoiceId}`} className="mt-1 block text-xs text-brand-600 hover:underline dark:text-brand-400">
                          {s.invoiceNumber ?? "Open draft"}
                        </Link>
                      )}
                    </td>
                    <td className={cx(table.td, "min-w-64")}>
                      {s.kind === "DEPOSIT" ? (
                        <span className="text-xs text-muted">Paid before work starts</span>
                      ) : s.signedOffOn ? (
                        <span className="inline-flex items-start gap-1.5 text-xs">
                          <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
                          <span>
                            Accepted {formatCalendarDate(s.signedOffOn)}
                            <span className="block text-muted">{s.signOffNote}</span>
                          </span>
                        </span>
                      ) : (
                        <div className="space-y-2 text-xs">
                          {s.reviewSentOn ? (
                            <p>
                              With the client since {formatCalendarDate(s.reviewSentOn)}.{" "}
                              <span className={cx(s.reviewDueOn! < today ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted")}>
                                {s.reviewDueOn! < today
                                  ? `The ${settings.clientReviewDays} working days ended ${formatCalendarDate(s.reviewDueOn)}: follow up, or treat it as accepted if your contract says so.`
                                  : `Answer due by ${formatCalendarDate(s.reviewDueOn)} (${settings.clientReviewDays} working days).`}
                              </span>
                            </p>
                          ) : (
                            <p className="text-muted">Not sent for review yet.</p>
                          )}
                          {canEdit && (
                            <details>
                              <summary className="cursor-pointer font-medium text-brand-600 dark:text-brand-400">{s.reviewSentOn ? "Record the client's answer" : "Sent for review / accepted"}</summary>
                              <div className="mt-2 space-y-3">
                                {!s.reviewSentOn && <ReviewForm action={reviewAction.bind(null, project.id, s.id)} today={today} />}
                                <SignOffForm action={signOffAction.bind(null, project.id, s.id)} today={today} />
                              </div>
                            </details>
                          )}
                        </div>
                      )}
                    </td>
                    {(canEdit || canInvoice) && (
                      <td className={cx(table.td, "text-right")}>
                        <div className="flex flex-wrap justify-end gap-2">
                          {canInvoice && open(s) && project.customerId && <ButtonForm action={invoiceStageAction.bind(null, project.id, s.id)} label="Create invoice" variant="primary" />}
                          {canEdit && open(s) && s.kind !== "CHANGE" && (
                            <ButtonForm action={removeStageAction.bind(null, project.id, s.id)} label="Remove" confirmMessage={`Remove "${s.label}" from the plan?`} />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && stages.length > 0 && (
          <div className="space-y-4 border-t border-line p-5">
            {billing.unplannedMinor > 0 && <AddStageForm action={addStageAction.bind(null, project.id)} milestones={milestones} />}
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-600 dark:text-brand-400">Start again from a common plan</summary>
              <div className="mt-3">
                <PresetForm action={presetAction.bind(null, project.id)} presets={Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label }))} replacing />
              </div>
            </details>
          </div>
        )}
      </Card>

      <Card title="Change requests" description="Extra work the client asks for after the scope is agreed. Once the client approves, its price is added to the project and to the payment plan.">
        <div className="space-y-4">
          {changes.length === 0 ? (
            <p className="text-sm text-muted">No change requests.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {changes.map((c) => (
                <li key={c.id} className="space-y-2 p-4 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {c.title} <Badge tone={changeTone[c.status as keyof typeof changeTone]}>{changeLabel[c.status as keyof typeof changeLabel]}</Badge>
                      </p>
                      <p className="text-xs text-muted">
                        {formatMoney(c.amountMinor)}
                        {c.extraDays > 0 ? ` · ${c.extraDays} extra day${c.extraDays === 1 ? "" : "s"}` : ""}
                        {c.description ? ` · ${c.description}` : ""}
                      </p>
                      {c.decidedOn && (
                        <p className="text-xs text-muted">
                          Decided {formatCalendarDate(c.decidedOn)}: {c.decisionNote}
                        </p>
                      )}
                    </div>
                    {canEdit && c.status === "DRAFT" && <ButtonForm action={sendChangeAction.bind(null, project.id, c.id)} label="Mark as sent to the client" />}
                  </div>
                  {canEdit && (c.status === "DRAFT" || c.status === "SENT") && (
                    <details>
                      <summary className="cursor-pointer font-medium text-brand-600 dark:text-brand-400">Record the client&apos;s decision</summary>
                      <div className="mt-2">
                        {isEditable(project.status) ? (
                          <DecideForm action={decideChangeAction.bind(null, project.id, c.id)} today={today} />
                        ) : (
                          <p className="text-xs text-muted">The project is locked. An approval can be recorded once it&apos;s reopened.</p>
                        )}
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-600 dark:text-brand-400">New change request</summary>
              <div className="mt-3">
                <ChangeRequestForm action={createChangeAction.bind(null, project.id)} />
              </div>
            </details>
          )}
        </div>
      </Card>
    </div>
  );
}
