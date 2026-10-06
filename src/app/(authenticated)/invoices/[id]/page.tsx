import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, Download, FileText, Lock, Mail } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge, InvoiceStateBadge } from "@/components/badges";
import { ButtonLink, Callout, Card, Disclosure, EmptyState, StatCard, table } from "@/components/ui";
import { emailConfig } from "@/lib/email";
import { formatCalendarDate, formatDateTime, todayInOperatingZone } from "@/lib/dates";
import { describeAuditAction, paymentMethodLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getInvoice, invoiceSources } from "@/modules/invoices";
import {
  addLineAction,
  addPeriodAction,
  deleteDraftAction,
  issueAction,
  notesAction,
  paymentAction,
  removeLineAction,
  sendAction,
  voidAction,
  voidPaymentAction,
} from "../actions";
import {
  DeleteDraftButton,
  IssueForm,
  LineForm,
  NotesForm,
  PaymentForm,
  PeriodForm,
  RemoveLineButton,
  SendForm,
  VoidForm,
  VoidPaymentForm,
} from "../invoice-forms";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "invoice.view")) return <AccessDenied what="invoices" />;
  const { id } = await params;
  const data = await getInvoice(actor, id);
  if (!data) notFound();
  const { invoice, lines, payments } = data;
  const draft = invoice.status === "DRAFT";
  const issued = invoice.status === "ISSUED";
  const canManage = can(actor, "invoice.manage");
  const canPay = can(actor, "invoice.recordPayment");
  const today = todayInOperatingZone();
  const sources = draft && canManage ? await invoiceSources(actor, invoice.customerId) : null;
  const livePayments = payments.filter((p) => !p.voidedAt);

  return (
    <div className="space-y-6">
      <Link href="/invoices" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Invoices
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{invoice.number ?? "Draft invoice"}</h1>
            <InvoiceStateBadge state={data.state} />
          </div>
          <p className="text-sm text-muted">
            for{" "}
            <Link href={`/customers/${invoice.customerId}`} className="font-medium text-fg hover:underline">
              {data.customerName}
            </Link>
            {invoice.issueDate && <> · Issued {formatCalendarDate(invoice.issueDate)}</>}
            {invoice.dueDate && <> · Due {formatCalendarDate(invoice.dueDate)}</>}
          </p>
        </div>
        <ButtonLink href={`/invoices/${invoice.id}/pdf`}>
          <Download className="size-4" aria-hidden /> PDF
        </ButtonLink>
      </div>

      {invoice.status === "VOID" && (
        <Callout tone="info" icon={Lock}>
          Voided {invoice.voidedAt && formatDateTime(invoice.voidedAt)} — “{invoice.voidReason}”. What it billed can be invoiced again.
        </Callout>
      )}
      {data.state === "OVERDUE" && <Callout tone="bad">Overdue: {formatMoney(data.balanceMinor, invoice.currency)} was due {formatCalendarDate(invoice.dueDate)}.</Callout>}
      {draft && <Callout tone="info" icon={FileText}>Draft: add lines, then issue it to give it a number. Nothing has been sent.</Callout>}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total" value={formatMoney(invoice.totalMinor, invoice.currency)} />
        <StatCard label="Paid" value={formatMoney(invoice.paidMinor, invoice.currency)} tone={data.state === "PAID" ? "good" : "default"} />
        <StatCard label="Balance" value={issued ? formatMoney(data.balanceMinor, invoice.currency) : "—"} tone={data.state === "OVERDUE" ? "bad" : "default"} />
      </div>

      <Card title="Lines" bodyClassName="p-0">
        {lines.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={FileText} title="No lines yet" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Description</th>
                  <th className={`${table.th} text-right`}>Qty</th>
                  <th className={`${table.th} text-right`}>Unit price</th>
                  <th className={`${table.th} text-right`}>Amount</th>
                  {draft && canManage && <th className={table.th} aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={table.row}>
                    <td className={`${table.td} min-w-56`}>
                      {l.description}
                      {l.projectCode && <div className="font-mono text-xs text-muted">{l.projectCode}</div>}
                    </td>
                    <td className={table.num}>{l.quantity}</td>
                    <td className={table.num}>{formatMoney(l.unitPriceMinor, invoice.currency)}</td>
                    <td className={table.num}>{formatMoney(l.amountMinor, invoice.currency)}</td>
                    {draft && canManage && (
                      <td className={table.td}>
                        <RemoveLineButton action={removeLineAction.bind(null, invoice.id, l.id)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {invoice.notes && !draft && (
        <Card title="Notes">
          <p className="whitespace-pre-line text-sm">{invoice.notes}</p>
        </Card>
      )}

      {draft && canManage && sources && (
        <div className="space-y-3">
          <Card title="Add a subscription period" description="Bills the next unbilled period at the subscription's price.">
            <PeriodForm action={addPeriodAction.bind(null, invoice.id)} subscriptions={sources.subscriptions} />
          </Card>
          <Card title="Add a line">
            <LineForm action={addLineAction.bind(null, invoice.id)} projects={sources.projects} />
          </Card>
          <Card>
            <NotesForm action={notesAction.bind(null, invoice.id)} notes={invoice.notes} version={invoice.version} />
          </Card>
          <Card title="Issue">
            <IssueForm
              action={issueAction.bind(null, invoice.id)}
              version={invoice.version}
              issueDate={today}
              dueDate={data.defaultDueDate}
              billTo={data.draftBillTo ? `${data.customerName} — attn. ${data.draftBillTo.name} (${data.draftBillTo.email})` : null}
            />
          </Card>
          <div className="flex justify-end">
            <DeleteDraftButton action={deleteDraftAction.bind(null, invoice.id)} />
          </div>
        </div>
      )}

      {issued && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card title="Payments" description={canPay ? undefined : "Only Admins record payments."}>
              {payments.length === 0 ? (
                <EmptyState title="No payments yet" />
              ) : (
                <ul className="-my-2 divide-y divide-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <div className="min-w-0">
                        <div className={p.voidedAt ? "text-muted line-through" : "font-medium"}>{formatMoney(p.amountMinor, invoice.currency)}</div>
                        <div className="text-xs text-muted">
                          {formatCalendarDate(p.paidOn)} · {paymentMethodLabel[p.method]}
                          {p.reference && <> · {p.reference}</>} · recorded by {p.recordedByName}
                        </div>
                        {p.voidedAt && <div className="text-xs text-red-600 dark:text-red-400">Voided — “{p.voidReason}”</div>}
                      </div>
                      {canPay && !p.voidedAt && <VoidPaymentForm action={voidPaymentAction.bind(null, invoice.id, p.id)} />}
                      {p.voidedAt && <Badge tone="gray">Void</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              {canPay && data.balanceMinor > 0 && (
                <Disclosure summary="Record a payment" className="mt-4">
                  <PaymentForm action={paymentAction.bind(null, invoice.id)} balance={formatMoney(data.balanceMinor, invoice.currency)} today={today} />
                </Disclosure>
              )}
            </Card>

            {canManage && (
              <Card title="Send" aside={<Mail className="size-4 text-muted" aria-hidden />}>
                <SendForm action={sendAction.bind(null, invoice.id)} defaultTo={invoice.billToEmail} sentTo={invoice.sentTo} canSend={emailConfig() !== null} />
                {invoice.sentAt && (
                  <p className="mt-3 text-xs text-muted">
                    Last sent to {invoice.sentTo} on {formatDateTime(invoice.sentAt)}.
                  </p>
                )}
              </Card>
            )}
          </div>

          <Card title="Bill to">
            <p className="text-sm font-medium">{invoice.billToName}</p>
            <p className="text-sm text-muted">{invoice.billToEmail ?? "No email address"}</p>
            {invoice.notes && <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-sm">{invoice.notes}</p>}
          </Card>
        </div>
      )}

      {canManage && issued && livePayments.length === 0 && (
        <Disclosure summary="Void this invoice" className="bg-surface shadow-xs">
          <p className="mb-3 text-sm text-muted">An issued invoice can&apos;t be edited. Void it with a reason, then create a corrected one. The periods and project amounts it billed become billable again.</p>
          <VoidForm action={voidAction.bind(null, invoice.id)} />
        </Disclosure>
      )}

      <Card title="Activity" aside={<Activity className="size-4 text-muted" aria-hidden />}>
        {data.activity.length === 0 ? (
          <EmptyState icon={Activity} title="No activity yet" />
        ) : (
          <ol className="relative space-y-4 border-l border-line pl-5">
            {data.activity.map((a) => (
              <li key={a.id} className="relative text-sm">
                <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-line-strong ring-4 ring-surface" aria-hidden />
                <p>
                  <span className="font-medium">{a.actorName ?? "System"}</span> <span className="text-muted">{describeAuditAction(a.action)}</span>
                  {a.reason && <span className="text-muted"> — “{a.reason}”</span>}
                </p>
                <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
