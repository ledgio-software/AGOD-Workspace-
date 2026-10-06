import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { ButtonLink, Callout, Card, PageHeader } from "@/components/ui";
import { todayInOperatingZone } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listCustomerOptions } from "@/modules/customers";
import { listActiveMembers } from "@/modules/projects";
import { listServiceOptions } from "@/modules/subscriptions";
import { createSubscriptionAction } from "../actions";
import { NewSubscriptionForm } from "../subscription-forms";

export default async function NewSubscriptionPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "subscription.manage")) return <AccessDenied what="creating subscriptions" />;
  const { customer } = await searchParams;
  const [customers, services, members] = await Promise.all([
    listCustomerOptions(actor),
    listServiceOptions(actor),
    listActiveMembers(actor),
  ]);
  const owners = members.filter((m) => m.role !== "TEAM_MEMBER");
  const backHref = customer ? `/customers/${customer}` : "/subscriptions";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Link>
      <PageHeader title="New subscription" description="Record what the customer agreed to. Changes after activation are kept as amendments." />
      {services.length === 0 ? (
        <Callout tone="warn" icon={Package} action={<ButtonLink href="/services" size="sm">Open Services</ButtonLink>}>
          Add at least one service to the catalogue first.
        </Callout>
      ) : (
        <Card>
          <NewSubscriptionForm
            action={createSubscriptionAction}
            customers={customers}
            services={services}
            owners={owners}
            defaults={{ customerId: customers.some((c) => c.id === customer) ? customer : undefined, ownerId: actor.id, startDate: todayInOperatingZone() }}
          />
        </Card>
      )}
    </div>
  );
}
