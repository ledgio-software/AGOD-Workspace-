import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listActiveMembers } from "@/modules/projects";
import { createCustomerAction } from "../actions";
import { CustomerForm } from "../customer-forms";

export default async function NewCustomerPage() {
  const actor = await requireUser();
  if (!can(actor, "customer.manage")) return <AccessDenied what="adding customers" />;
  const owners = (await listActiveMembers(actor)).filter((m) => m.role !== "TEAM_MEMBER");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Customers
      </Link>
      <PageHeader title="New customer" description="Add contacts on the next page, then link projects to the customer." />
      <Card>
        <CustomerForm action={createCustomerAction} owners={owners} defaults={{ ownerId: actor.id }} submitLabel="Create customer" />
      </Card>
    </div>
  );
}
