import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, Archive, FileText, FolderKanban, Mail, Phone, Plus, Repeat, UserRound } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge, CustomerStatusBadge, InvoiceStateBadge, ProjectStatusBadge, RenewalBadge, SubscriptionStatusBadge } from "@/components/badges";
import { ButtonLink, Callout, Card, Disclosure, EmptyState, StatCard, table } from "@/components/ui";
import { formatCalendarDate, formatDateTime, todayInOperatingZone } from "@/lib/dates";
import { billingCadenceSuffix, contactChannelLabel, customerTypeLabel, describeAuditAction } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getCustomer } from "@/modules/customers";
import { listActiveMembers } from "@/modules/projects";
import { invoiceTotals, listInvoices } from "@/modules/invoices";
import { listSubscriptions, recurringTotals } from "@/modules/subscriptions";
import { addContactAction, archiveCustomerAction, setContactActiveAction, updateContactAction, updateCustomerAction } from "../actions";
import { ArchiveForm, ContactActiveForm, ContactForm, CustomerForm } from "../customer-forms";

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "customer.view")) return <AccessDenied what="customers" />;
  const { id } = await params;
  const data = await getCustomer(actor, id);
  if (!data) notFound();
  const { customer, contacts, projects, activity } = data;
  const archived = customer.status === "ARCHIVED";
  const canManage = can(actor, "customer.manage");
  const canEdit = canManage && !archived;
  const subs = can(actor, "subscription.view") ? await listSubscriptions(actor, { customerId: customer.id, status: "ALL" }) : null;
  const mrr = subs ? recurringTotals(subs) : [];
  const invs = can(actor, "invoice.view") ? await listInvoices(actor, { customerId: customer.id }) : null;
  const owners = canEdit ? (await listActiveMembers(actor)).filter((m) => m.role !== "TEAM_MEMBER") : [];

  const live = projects.filter((p) => p.status !== "CANCELLED");
  const open = projects.filter((p) => p.status !== "COMPLETED" && p.status !== "CANCELLED");
  const totals = new Map<string, number>();
  for (const p of live) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.totalValueMinor);
  const activeContacts = contacts.filter((c) => c.active);
  const inactiveContacts = contacts.filter((c) => !c.active);

  return (
    <div className="space-y-6">
      <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Customers
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
            <CustomerStatusBadge status={customer.status} />
          </div>
          <p className="text-sm text-muted">
            {customerTypeLabel[customer.type]} · Owner {data.ownerName}
            {customer.externalReference && <> · Ref {customer.externalReference}</>}
          </p>
        </div>
        {canEdit && can(actor, "project.create") && (
          <ButtonLink href={`/projects/new?customer=${customer.id}`} variant="primary">
            <Plus className="size-4" aria-hidden /> New project
          </ButtonLink>
        )}
      </div>

      {archived && (
        <Callout tone="warn" icon={Archive}>
          Archived{customer.archivedAt && <> {formatDateTime(customer.archivedAt)}</>}. It can&apos;t take new projects or contact changes until it is restored.
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Projects" value={projects.length} hint={`${open.length} open`} icon={FolderKanban} />
        <StatCard
          label="Project value"
          value={totals.size === 0 ? "—" : [...totals].map(([cur, minor]) => formatMoney(minor, cur)).join(" + ")}
          hint="Excludes cancelled projects"
        />
        <StatCard label="Active contacts" value={activeContacts.length} icon={UserRound} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Contacts" description="The primary contact is who AGOD talks to first.">
            {activeContacts.length === 0 ? (
              <EmptyState icon={UserRound} title="No contacts yet">
                {canEdit ? "Add the person AGOD deals with. The first contact becomes the primary one." : undefined}
              </EmptyState>
            ) : (
              <ul className="-my-2 divide-y divide-line">
                {activeContacts.map((c) => (
                  <li key={c.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {c.name}
                          {c.isPrimary && <Badge tone="blue">Primary</Badge>}
                          {c.isBilling && <Badge tone="violet">Billing</Badge>}
                        </div>
                        {c.role && <div className="text-xs text-muted">{c.role}</div>}
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {c.email && (
                            <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
                              <Mail className="size-3.5" aria-hidden /> {c.email}
                            </a>
                          )}
                          {c.phone && (
                            <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
                              <Phone className="size-3.5" aria-hidden /> {c.phone}
                            </a>
                          )}
                          <span className="text-xs text-muted">Prefers {contactChannelLabel[c.preferredChannel]}</span>
                        </div>
                      </div>
                      {canEdit && <ContactActiveForm action={setContactActiveAction.bind(null, customer.id, c.id)} active />}
                    </div>
                    {canEdit && (
                      <Disclosure summary={`Edit ${c.name}`}>
                        <ContactForm action={updateContactAction.bind(null, customer.id, c.id)} defaults={c} submitLabel="Save contact" />
                      </Disclosure>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <Disclosure summary="Add a contact" className="mt-4">
                <ContactForm action={addContactAction.bind(null, customer.id)} submitLabel="Add contact" resetOnSuccess />
              </Disclosure>
            )}
            {inactiveContacts.length > 0 && (
              <Disclosure summary={`Inactive contacts (${inactiveContacts.length})`} className="mt-4">
                <ul className="divide-y divide-line">
                  {inactiveContacts.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="text-muted">
                        {c.name} · {c.email ?? c.phone}
                      </span>
                      {canEdit && <ContactActiveForm action={setContactActiveAction.bind(null, customer.id, c.id)} active={false} />}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </Card>

          {subs && (
            <Card
              title="Subscriptions"
              description={mrr.length ? `Monthly recurring value ${mrr.map((m) => formatMoney(m.monthlyMinor, m.currency)).join(" + ")}` : undefined}
              aside={
                canEdit && can(actor, "subscription.manage") ? (
                  <ButtonLink href={`/subscriptions/new?customer=${customer.id}`} size="sm">
                    <Plus className="size-3.5" aria-hidden /> Add
                  </ButtonLink>
                ) : undefined
              }
            >
              {subs.length === 0 ? (
                <EmptyState icon={Repeat} title="No subscriptions yet" />
              ) : (
                <ul className="-my-2 divide-y divide-line">
                  {subs.map((sub) => (
                    <li key={sub.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0">
                        <Link href={`/subscriptions/${sub.id}`} className="font-medium hover:text-brand-600">
                          {sub.serviceName}
                        </Link>
                        <div className="text-xs text-muted">
                          {formatMoney(sub.priceMinor * sub.quantity, sub.currency)} {billingCadenceSuffix[sub.billingCadence]}
                          {(sub.renewalDate ?? sub.endDate) && <> · renews {formatCalendarDate(sub.renewalDate ?? sub.endDate)}</>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RenewalBadge renewal={sub.renewal} />
                        <SubscriptionStatusBadge status={sub.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {invs && (
            <Card
              title="Invoices"
              description={invs.length ? `Outstanding ${formatMoney(invoiceTotals(invs, todayInOperatingZone()).outstandingMinor)}` : undefined}
              aside={
                canEdit && can(actor, "invoice.manage") ? (
                  <ButtonLink href={`/invoices/new?customer=${customer.id}`} size="sm">
                    <Plus className="size-3.5" aria-hidden /> New
                  </ButtonLink>
                ) : undefined
              }
            >
              {invs.length === 0 ? (
                <EmptyState icon={FileText} title="No invoices yet" />
              ) : (
                <ul className="-my-2 divide-y divide-line">
                  {invs.slice(0, 6).map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0">
                        <Link href={`/invoices/${i.id}`} className="font-medium hover:text-brand-600">
                          {i.number ?? "Draft"}
                        </Link>
                        <div className="text-xs text-muted">
                          {formatMoney(i.totalMinor, i.currency)}
                          {i.dueDate && <> · due {formatCalendarDate(i.dueDate)}</>}
                        </div>
                      </div>
                      <InvoiceStateBadge state={i.state} />
                    </li>
                  ))}
                </ul>
              )}
              {invs.length > 6 && (
                <Link href={`/invoices?q=${encodeURIComponent(customer.name)}`} className="mt-3 block text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                  All {invs.length} invoices
                </Link>
              )}
            </Card>
          )}

          <Card title="Projects">
            {projects.length === 0 ? (
              <EmptyState icon={FolderKanban} title="No projects for this customer yet" />
            ) : (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead className={table.head}>
                    <tr>
                      <th className={table.th}>Project</th>
                      <th className={table.th}>Status</th>
                      <th className={`${table.th} text-right`}>Value</th>
                      <th className={table.th}>Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id} className={table.row}>
                        <td className={`${table.td} min-w-48`}>
                          <Link href={`/projects/${p.id}`} className="font-medium hover:text-brand-600">
                            {p.name}
                          </Link>
                          <div className="font-mono text-xs text-muted">{p.code}</div>
                        </td>
                        <td className={table.td}>
                          <ProjectStatusBadge status={p.status} />
                        </td>
                        <td className={table.num}>{formatMoney(p.totalValueMinor, p.currency)}</td>
                        <td className={`${table.td} whitespace-nowrap`}>{formatCalendarDate(p.targetDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Meta label="Type">{customerTypeLabel[customer.type]}</Meta>
              <Meta label="Account owner">{data.ownerName}</Meta>
              <Meta label="Reference">{customer.externalReference ?? "—"}</Meta>
              <Meta label="Customer since">{formatCalendarDate(customer.createdAt.toISOString().slice(0, 10))}</Meta>
            </dl>
            {customer.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-sm">{customer.notes}</p>}
          </Card>

          <Card title="Activity" aside={<Activity className="size-4 text-muted" aria-hidden />}>
            {activity.length === 0 ? (
              <EmptyState icon={Activity} title="No activity yet" />
            ) : (
              <ol className="relative space-y-4 border-l border-line pl-5">
                {activity.map((a) => (
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
      </div>

      {canManage && (
        <div className="space-y-3">
          {canEdit && (
            <Disclosure summary="Edit customer details" className="bg-surface shadow-xs">
              <CustomerForm
                action={updateCustomerAction.bind(null, customer.id)}
                owners={owners}
                submitLabel="Save changes"
                defaults={{
                  name: customer.name,
                  type: customer.type,
                  status: customer.status,
                  ownerId: customer.ownerId,
                  notes: customer.notes,
                  externalReference: customer.externalReference,
                  version: customer.version,
                }}
              />
            </Disclosure>
          )}
          <Disclosure summary={archived ? "Restore this customer" : "Archive this customer"} className="bg-surface shadow-xs">
            <p className="mb-3 text-sm text-muted">
              {archived
                ? "Restoring makes the customer active again."
                : "Archiving hides the customer from lists and pickers. Its history and projects stay. Finish or cancel open projects and end its subscriptions first."}
            </p>
            <ArchiveForm action={archiveCustomerAction.bind(null, customer.id)} archived={archived} />
          </Disclosure>
        </div>
      )}
    </div>
  );
}
