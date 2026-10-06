import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, FilePen, Lock, RefreshCw } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge, RenewalBadge, SubscriptionStatusBadge } from "@/components/badges";
import { Callout, Card, Disclosure, EmptyState, StatCard } from "@/components/ui";
import { formatCalendarDate, formatDateTime, todayInOperatingZone } from "@/lib/dates";
import {
  billingCadenceLabel,
  billingCadenceSuffix,
  describeAuditAction,
  pricingBasisLabel,
  subscriptionTermLabel,
} from "@/lib/labels";
import { formatMoney, minorToInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listActiveMembers } from "@/modules/projects";
import { getSubscription, renewalSuggestion } from "@/modules/subscriptions";
import { invoiceSubscriptionAction } from "../../invoices/actions";
import { InvoiceSubscriptionButton } from "../../invoices/invoice-forms";
import { allowedSubscriptionTransitions, isLive } from "@/modules/subscriptions/rules";
import { amendAction, changeStatusAction, renewAction, updateDetailsAction, updateDraftAction } from "../actions";
import { AmendForm, DetailsForm, DraftEditForm, RenewForm, StatusForm } from "../subscription-forms";

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

/** Shows one amended value in words. */
function termValue(field: string, value: unknown, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "priceMinor") return formatMoney(Number(value), currency);
  if (field === "billingCadence") return billingCadenceLabel[value as keyof typeof billingCadenceLabel] ?? String(value);
  if (field === "pricingBasis") return pricingBasisLabel[value as keyof typeof pricingBasisLabel] ?? String(value);
  if (field === "endDate" || field === "renewalDate") return formatCalendarDate(String(value));
  return String(value);
}

export default async function SubscriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "subscription.view")) return <AccessDenied what="subscriptions" />;
  const { id } = await params;
  const data = await getSubscription(actor, id);
  if (!data) notFound();
  const s = data.subscription;
  const finished = s.status === "ENDED" || s.status === "CANCELLED";
  const canManage = can(actor, "subscription.manage") && !finished;
  const owners = canManage ? (await listActiveMembers(actor)).filter((m) => m.role !== "TEAM_MEMBER") : [];
  const allowed = allowedSubscriptionTransitions(s.status);
  const total = s.priceMinor * s.quantity;
  const details = {
    ownerId: s.ownerId,
    renewalOwnerId: s.renewalOwnerId,
    externalReference: s.externalReference,
    notes: s.notes,
  };
  const terms = {
    billingCadence: s.billingCadence,
    price: minorToInput(s.priceMinor),
    pricingBasis: s.pricingBasis,
    quantity: s.quantity,
    endDate: s.endDate,
    renewalDate: s.renewalDate,
    noticePeriodDays: s.noticePeriodDays,
    paymentTerms: s.paymentTerms,
  };

  return (
    <div className="space-y-6">
      <Link href="/subscriptions" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Subscriptions
      </Link>

      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{s.serviceName}</h1>
          <SubscriptionStatusBadge status={s.status} />
          <RenewalBadge renewal={data.renewal} />
        </div>
        <p className="text-sm text-muted">
          for{" "}
          <Link href={`/customers/${s.customerId}`} className="font-medium text-fg hover:underline">
            {data.customerName}
          </Link>{" "}
          · Owner {data.ownerName}
          {s.externalReference && <> · Ref {s.externalReference}</>}
        </p>
      </div>

      {finished && (
        <Callout tone="info" icon={Lock}>
          {s.status === "ENDED" ? "Ended" : "Cancelled"}
          {s.endedAt && <> {formatDateTime(s.endedAt)}</>}
          {s.statusReason && <> — “{s.statusReason}”</>}. It can no longer be changed; create a new subscription to sell it again.
        </Callout>
      )}
      {s.status === "PAUSED" && s.statusReason && (
        <Callout tone="warn">Paused — “{s.statusReason}”. Paused subscriptions don&apos;t count towards monthly recurring value.</Callout>
      )}
      {s.status === "DRAFT" && (
        <Callout tone="info" icon={FilePen}>
          Draft: still being negotiated. Edit anything below, then activate it once the customer agrees.
        </Callout>
      )}
      {data.renewal?.kind === "PAST_END" && (
        <Callout tone="bad">The end date has passed. Amend the end date if it was renewed, or end the subscription.</Callout>
      )}

      {can(actor, "invoice.manage") && s.status === "ACTIVE" && (
        <div>
          <InvoiceSubscriptionButton action={invoiceSubscriptionAction.bind(null, s.id)} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Price" value={formatMoney(total, s.currency)} hint={`${billingCadenceLabel[s.billingCadence]}${s.quantity > 1 ? ` · ${s.quantity} × ${formatMoney(s.priceMinor, s.currency)}` : ""}`} />
        <StatCard label="Per month" value={data.monthlyValueMinor === null ? "—" : formatMoney(data.monthlyValueMinor, s.currency)} hint={data.monthlyValueMinor === null ? "Not recurring monthly" : "Spread over the billing period"} />
        <StatCard
          label="Next renewal"
          value={formatCalendarDate(s.renewalDate ?? s.endDate)}
          hint={`Notice period ${s.noticePeriodDays} days`}
          tone={data.renewal ? "warn" : "default"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Terms">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Meta label="Price">
                {formatMoney(s.priceMinor, s.currency)} {billingCadenceSuffix[s.billingCadence]}
              </Meta>
              <Meta label="Quantity">{s.quantity}</Meta>
              <Meta label="Pricing basis">{pricingBasisLabel[s.pricingBasis]}</Meta>
              <Meta label="Start date">{formatCalendarDate(s.startDate)}</Meta>
              <Meta label="End date">{s.endDate ? formatCalendarDate(s.endDate) : "Open-ended"}</Meta>
              <Meta label="Renewal date">{formatCalendarDate(s.renewalDate)}</Meta>
              <Meta label="Notice period">{s.noticePeriodDays} days</Meta>
              <Meta label="Payment terms">{s.paymentTerms ?? "—"}</Meta>
              <Meta label="Renewal owner">{data.renewalOwnerName ?? data.ownerName}</Meta>
            </dl>
            {s.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-sm">{s.notes}</p>}
          </Card>

          <Card title="Renewals and amendments" description="Changes to the agreed terms after activation, previous values kept.">
            {data.amendments.length === 0 ? (
              <EmptyState icon={FilePen} title="No renewals or amendments yet" />
            ) : (
              <ul className="-my-2 divide-y divide-line">
                {data.amendments.map((a) => (
                  <li key={a.id} className="space-y-1.5 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="inline-flex items-center gap-2 font-medium">
                        {a.kind === "RENEWAL" ? <Badge tone="green">Renewal</Badge> : <Badge tone="blue">Amendment</Badge>}
                        Effective {formatCalendarDate(a.effectiveDate)}
                      </span>
                      <span className="text-xs text-muted">
                        {a.actorName} · {formatDateTime(a.createdAt)}
                      </span>
                    </div>
                    <p className="text-muted">“{a.reason}”</p>
                    <ul className="space-y-0.5">
                      {Object.entries(a.changes as Record<string, { from: unknown; to: unknown }>).map(([field, change]) => (
                        <li key={field}>
                          <span className="text-muted">{subscriptionTermLabel[field] ?? field}:</span>{" "}
                          <span className="line-through decoration-muted">{termValue(field, change.from, s.currency)}</span> →{" "}
                          <span className="font-medium">{termValue(field, change.to, s.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

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
                    {a.action === "subscription.status_changed" && (
                      <span className="text-muted"> to {String((a.afterJson as { status?: string })?.status ?? "").toLowerCase()}</span>
                    )}
                    {a.reason && <span className="text-muted"> — “{a.reason}”</span>}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {canManage && (
        <div className="space-y-3">
          {allowed.length > 0 && (
            <Card>
              <StatusForm action={changeStatusAction.bind(null, s.id)} allowed={allowed} version={s.version} from={s.status} />
            </Card>
          )}
          {s.status === "DRAFT" ? (
            <Disclosure summary="Edit draft" className="bg-surface shadow-xs">
              <DraftEditForm action={updateDraftAction.bind(null, s.id)} owners={owners} defaults={{ ...terms, ...details, startDate: s.startDate, version: s.version }} />
            </Disclosure>
          ) : (
            isLive(s.status) && (
              <>
                <Disclosure
                  summary={
                    <span className="inline-flex items-center gap-2">
                      <RefreshCw className="size-4 text-muted" aria-hidden /> Record a renewal
                      {data.renewal && <Badge tone="amber">Due</Badge>}
                    </span>
                  }
                  className="bg-surface shadow-xs"
                >
                  <RenewForm
                    action={renewAction.bind(null, s.id)}
                    defaults={{ ...renewalSuggestion(s), price: minorToInput(s.priceMinor), hasEndDate: s.endDate !== null, version: s.version }}
                  />
                </Disclosure>
                <Disclosure summary="Amend terms (price, billing, dates)" className="bg-surface shadow-xs">
                  <AmendForm action={amendAction.bind(null, s.id)} defaults={{ ...terms, version: s.version }} today={todayInOperatingZone()} />
                </Disclosure>
                <Disclosure summary="Edit owners, reference and notes" className="bg-surface shadow-xs">
                  <DetailsForm action={updateDetailsAction.bind(null, s.id)} owners={owners} defaults={{ ...details, version: s.version }} />
                </Disclosure>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
