import Link from "next/link";
import { AlarmClock, Plus, Repeat, Search, Wallet } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { RenewalBadge, SubscriptionStatusBadge } from "@/components/badges";
import { inputClass } from "@/components/form";
import { ButtonLink, Card, EmptyState, PageHeader, StatCard, buttonClass, table } from "@/components/ui";
import { formatCalendarDate } from "@/lib/dates";
import { billingCadenceSuffix, subscriptionStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listSubscriptions, recurringTotals } from "@/modules/subscriptions";

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; attention?: string; within?: string }>;
}) {
  const actor = await requireUser();
  if (!can(actor, "subscription.view")) return <AccessDenied what="subscriptions" />;
  const { q, status, attention, within } = await searchParams;
  const needsAttention = attention === "1";
  const rows = await listSubscriptions(actor, { q, status: status as never, attention: needsAttention, within: within as never });
  // Headline numbers always describe all live subscriptions, whatever the filters.
  const live = q || status || needsAttention || within ? await listSubscriptions(actor) : rows;
  const mrr = recurringTotals(live);
  const due = live.filter((s) => s.renewal);
  const filtered = Boolean(q || status || needsAttention || within);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customers"
        title="Subscriptions"
        description="What each customer has agreed to: price, billing and renewal dates."
        actions={
          can(actor, "subscription.manage") && (
            <ButtonLink href="/subscriptions/new" variant="primary">
              <Plus className="size-4" aria-hidden /> New subscription
            </ButtonLink>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Live subscriptions" value={live.length} hint={`${live.filter((s) => s.status === "PAUSED").length} paused`} icon={Repeat} />
        <StatCard
          label="Monthly recurring value"
          value={mrr.length === 0 ? "—" : mrr.map((m) => formatMoney(m.monthlyMinor, m.currency)).join(" + ")}
          hint="Active only; quarterly and annual spread per month"
          icon={Wallet}
        />
        <StatCard
          label="Renewals needing action"
          value={due.length}
          hint="Within the notice period or overdue"
          icon={AlarmClock}
          tone={due.length > 0 ? "warn" : "default"}
          href={due.length > 0 ? "/subscriptions?attention=1" : undefined}
        />
      </div>

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3" role="search">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search customer, service or reference" className={`${inputClass} pl-9`} />
          </div>
          <select name="status" defaultValue={status ?? ""} aria-label="Status" className={`${inputClass} w-auto`}>
            <option value="">Live (active and paused)</option>
            <option value="ALL">All</option>
            {Object.entries(subscriptionStatusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select name="within" defaultValue={within ?? ""} aria-label="Renewing within" className={`${inputClass} w-auto`}>
            <option value="">Any renewal date</option>
            <option value="30">Renewing within 30 days</option>
            <option value="60">Renewing within 60 days</option>
            <option value="90">Renewing within 90 days</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="attention" value="1" defaultChecked={needsAttention} className="size-4 accent-brand-600" />
            Renewal due
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            Filter
          </button>
          {filtered && (
            <Link href="/subscriptions" className="text-sm text-muted hover:text-fg">
              Clear
            </Link>
          )}
          <span className="ml-auto text-xs text-muted">
            {rows.length} subscription{rows.length === 1 ? "" : "s"}
          </span>
        </form>

        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Repeat} title={filtered ? "No subscriptions match these filters" : "No subscriptions yet"}>
              {filtered ? undefined : "Add the services you sell on the Services page, then create a subscription for a customer."}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Customer and service</th>
                  <th className={table.th}>Status</th>
                  <th className={`${table.th} text-right`}>Price</th>
                  <th className={`${table.th} text-right`}>Per month</th>
                  <th className={table.th}>Renewal</th>
                  <th className={table.th}>Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className={table.row}>
                    <td className={`${table.td} min-w-56`}>
                      <Link href={`/subscriptions/${s.id}`} className="font-medium hover:text-brand-600">
                        {s.serviceName}
                      </Link>
                      <div className="text-xs text-muted">
                        <Link href={`/customers/${s.customerId}`} className="hover:text-fg hover:underline">
                          {s.customerName}
                        </Link>
                      </div>
                    </td>
                    <td className={table.td}>
                      <SubscriptionStatusBadge status={s.status} />
                    </td>
                    <td className={table.num}>
                      {formatMoney(s.priceMinor * s.quantity, s.currency)}{" "}
                      <span className="text-xs text-muted">{billingCadenceSuffix[s.billingCadence]}</span>
                    </td>
                    <td className={table.num}>{s.monthlyValueMinor === null ? "—" : formatMoney(s.monthlyValueMinor, s.currency)}</td>
                    <td className={`${table.td} whitespace-nowrap`}>
                      <div>{formatCalendarDate(s.renewalDate ?? s.endDate)}</div>
                      <RenewalBadge renewal={s.renewal} />
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>{s.ownerName}</td>
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
