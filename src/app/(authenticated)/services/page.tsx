import Link from "next/link";
import { Package } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/badges";
import { Card, Disclosure, EmptyState, PageHeader, table } from "@/components/ui";
import { billingCadenceLabel } from "@/lib/labels";
import { formatMoney, minorToInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listServices } from "@/modules/subscriptions";
import { createServiceAction, setServiceActiveAction, updateServiceAction } from "../subscriptions/actions";
import { ServiceActiveForm, ServiceForm } from "../subscriptions/subscription-forms";

export default async function ServicesPage() {
  const actor = await requireUser();
  if (!can(actor, "subscription.view")) return <AccessDenied what="the service catalogue" />;
  const services = await listServices(actor);
  const canManage = can(actor, "subscription.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customers"
        title="Services"
        description="The catalogue of what AGOD sells. Subscriptions copy a service's defaults and then keep their own agreed terms."
      />

      {canManage && (
        <Disclosure summary="Add a service" className="bg-surface shadow-xs">
          <ServiceForm action={createServiceAction} submitLabel="Add service" />
        </Disclosure>
      )}

      <Card bodyClassName={services.length ? "p-0" : undefined}>
        {services.length === 0 ? (
          <EmptyState icon={Package} title="No services yet">
            Add what AGOD sells, e.g. website hosting, maintenance or a support plan.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Service</th>
                  <th className={table.th}>Default billing</th>
                  <th className={`${table.th} text-right`}>Default price</th>
                  <th className={`${table.th} text-right`}>Live subscriptions</th>
                  <th className={table.th}>Status</th>
                  {canManage && <th className={table.th} aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className={table.row}>
                    <td className={`${table.td} min-w-56`}>
                      <div className="font-medium">{s.name}</div>
                      <div className="font-mono text-xs text-muted">{s.code}</div>
                      {s.description && <div className="mt-1 max-w-md text-xs text-muted">{s.description}</div>}
                    </td>
                    <td className={table.td}>{billingCadenceLabel[s.defaultCadence]}</td>
                    <td className={table.num}>{s.defaultPriceMinor === null ? "—" : formatMoney(s.defaultPriceMinor, s.currency)}</td>
                    <td className={table.num}>
                      {s.liveSubscriptions > 0 ? (
                        <Link href={`/subscriptions?q=${encodeURIComponent(s.name)}`} className="hover:text-brand-600 hover:underline">
                          {s.liveSubscriptions}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className={table.td}>{s.active ? <Badge tone="green">Offered</Badge> : <Badge>Retired</Badge>}</td>
                    {canManage && (
                      <td className={`${table.td} min-w-40`}>
                        <div className="flex flex-col items-start gap-2">
                          <ServiceActiveForm action={setServiceActiveAction.bind(null, s.id)} active={s.active} />
                          <details className="text-sm">
                            <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">Edit</summary>
                            <div className="mt-3 w-80 rounded-lg border border-line bg-surface p-3 shadow-sm">
                              <ServiceForm
                                action={updateServiceAction.bind(null, s.id)}
                                submitLabel="Save service"
                                defaults={{
                                  code: s.code,
                                  name: s.name,
                                  description: s.description,
                                  defaultCadence: s.defaultCadence,
                                  defaultPrice: s.defaultPriceMinor === null ? "" : minorToInput(s.defaultPriceMinor),
                                  version: s.version,
                                }}
                              />
                            </div>
                          </details>
                        </div>
                      </td>
                    )}
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
