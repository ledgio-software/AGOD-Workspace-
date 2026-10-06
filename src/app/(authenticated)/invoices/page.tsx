import Link from "next/link";
import { AlertTriangle, FilePen, FileText, Plus, Search, Settings, Wallet } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { InvoiceStateBadge } from "@/components/badges";
import { inputClass } from "@/components/form";
import { ButtonLink, Card, EmptyState, PageHeader, StatCard, buttonClass, table } from "@/components/ui";
import { addDays } from "@/modules/notifications/deadlines";
import { formatCalendarDate, todayInOperatingZone } from "@/lib/dates";
import { invoiceStateLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { invoiceTotals, listInvoices } from "@/modules/invoices";
import { prepareAction } from "./actions";
import { PrepareForm } from "./invoice-forms";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "invoice.view")) return <AccessDenied what="invoices" />;
  const { q, state } = await searchParams;
  const today = todayInOperatingZone();
  const [rows, all] = await Promise.all([listInvoices(actor, { q, state: state as never }), q || state ? listInvoices(actor) : null]);
  const totals = invoiceTotals(all ?? rows, today);
  const filtered = Boolean(q || state);
  const canManage = can(actor, "invoice.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Invoices"
        description="What customers owe AGOD: drafts, issued invoices and payments received."
        actions={
          <>
            {can(actor, "invoice.settings") && (
              <ButtonLink href="/invoices/settings">
                <Settings className="size-4" aria-hidden /> Settings
              </ButtonLink>
            )}
            {canManage && (
              <ButtonLink href="/invoices/new" variant="primary">
                <Plus className="size-4" aria-hidden /> New invoice
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Outstanding" value={formatMoney(totals.outstandingMinor)} icon={Wallet} href="/invoices?state=UNPAID" />
        <StatCard
          label="Overdue"
          value={formatMoney(totals.overdueMinor)}
          hint={`${totals.overdueCount} invoice${totals.overdueCount === 1 ? "" : "s"}`}
          icon={AlertTriangle}
          tone={totals.overdueCount ? "bad" : "default"}
          href={totals.overdueCount ? "/invoices?state=OVERDUE" : undefined}
        />
        <StatCard label="Issued this month" value={formatMoney(totals.issuedThisMonthMinor)} icon={FileText} />
        <StatCard label="Drafts" value={totals.drafts} hint="Not sent yet" icon={FilePen} href={totals.drafts ? "/invoices?state=DRAFT" : undefined} />
      </div>

      {canManage && (
        <Card title="Subscription invoices" description="Creates one draft per customer with each active subscription's next unbilled period. Nothing is sent until you issue it.">
          <PrepareForm action={prepareAction} through={addDays(today, 7)} />
        </Card>
      )}

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3" role="search">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search number or customer" className={`${inputClass} pl-9`} />
          </div>
          <select name="state" defaultValue={state ?? ""} aria-label="Status" className={`${inputClass} w-auto`}>
            <option value="">All invoices</option>
            <option value="UNPAID">Unpaid (any)</option>
            {Object.entries(invoiceStateLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass("secondary")}>
            Filter
          </button>
          {filtered && (
            <Link href="/invoices" className="text-sm text-muted hover:text-fg">
              Clear
            </Link>
          )}
          <span className="ml-auto text-xs text-muted">
            {rows.length} invoice{rows.length === 1 ? "" : "s"}
          </span>
        </form>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={FileText} title={filtered ? "No invoices match these filters" : "No invoices yet"}>
              {filtered ? undefined : "Create an invoice for a customer, or prepare invoices from your subscriptions."}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Invoice</th>
                  <th className={table.th}>Customer</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Due</th>
                  <th className={`${table.th} text-right`}>Total</th>
                  <th className={`${table.th} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={table.row}>
                    <td className={table.td}>
                      <Link href={`/invoices/${i.id}`} className="font-medium hover:text-brand-600">
                        {i.number ?? "Draft"}
                      </Link>
                      {i.issueDate && <div className="text-xs text-muted">Issued {formatCalendarDate(i.issueDate)}</div>}
                    </td>
                    <td className={`${table.td} min-w-40`}>
                      <Link href={`/customers/${i.customerId}`} className="hover:text-brand-600 hover:underline">
                        {i.customerName}
                      </Link>
                    </td>
                    <td className={table.td}>
                      <InvoiceStateBadge state={i.state} />
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>{formatCalendarDate(i.dueDate)}</td>
                    <td className={table.num}>{formatMoney(i.totalMinor, i.currency)}</td>
                    <td className={table.num}>{i.balanceMinor > 0 ? formatMoney(i.balanceMinor, i.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
