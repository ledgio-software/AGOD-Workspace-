import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { CustomerStatusBadge } from "@/components/badges";
import { inputClass } from "@/components/form";
import { Avatar, ButtonLink, Card, EmptyState, PageHeader, buttonClass, table } from "@/components/ui";
import { customerStatusLabel, customerTypeLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listCustomers } from "@/modules/customers";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "customer.view")) return <AccessDenied what="customers" />;
  const { q, status } = await searchParams;
  const customers = await listCustomers(actor, { q, status: status as never });
  const filtered = Boolean(q || status);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work"
        title="Customers"
        description="Who AGOD works for, their contacts and their projects."
        actions={
          can(actor, "customer.manage") && (
            <ButtonLink href="/customers/new" variant="primary">
              <Plus className="size-4" aria-hidden /> New customer
            </ButtonLink>
          )
        }
      />

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3" role="search">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search name or reference" className={`${inputClass} pl-9`} />
          </div>
          <select name="status" defaultValue={status ?? ""} aria-label="Status" className={`${inputClass} w-auto`}>
            <option value="">All but archived</option>
            {Object.entries(customerStatusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass("secondary")}>
            Filter
          </button>
          {filtered && (
            <Link href="/customers" className="text-sm text-muted hover:text-fg">
              Clear
            </Link>
          )}
          <span className="ml-auto text-xs text-muted">
            {customers.length} customer{customers.length === 1 ? "" : "s"}
          </span>
        </form>

        {customers.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Building2} title={filtered ? "No customers match these filters" : "No customers yet"}>
              {filtered ? undefined : "Add a customer here, or create an external project and type a new customer's name."}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Customer</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Primary contact</th>
                  <th className={`${table.th} text-right`}>Projects</th>
                  <th className={`${table.th} text-right`}>Project value</th>
                  <th className={table.th}>Owner</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className={table.row}>
                    <td className={`${table.td} min-w-48`}>
                      <Link href={`/customers/${c.id}`} className="font-medium hover:text-brand-600">
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted">{customerTypeLabel[c.type]}</div>
                    </td>
                    <td className={table.td}>
                      <CustomerStatusBadge status={c.status} />
                    </td>
                    <td className={`${table.td} min-w-44`}>
                      {c.primaryContact ? (
                        <>
                          <div>{c.primaryContact.name}</div>
                          <div className="text-xs text-muted">{c.primaryContact.email ?? c.primaryContact.phone}</div>
                        </>
                      ) : (
                        <span className="text-muted">None yet</span>
                      )}
                    </td>
                    <td className={table.num}>
                      {c.projectCount}
                      {c.openProjectCount > 0 && <span className="text-xs text-muted"> ({c.openProjectCount} open)</span>}
                    </td>
                    <td className={table.num}>
                      {c.valueByCurrency.length === 0
                        ? "—"
                        : c.valueByCurrency.map((v) => <div key={v.currency}>{formatMoney(v.totalMinor, v.currency)}</div>)}
                    </td>
                    <td className={table.td}>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <Avatar name={c.ownerName} size="sm" />
                        {c.ownerName}
                      </span>
                    </td>
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
