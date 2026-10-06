import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listCustomerOptions } from "@/modules/customers";
import { createDraftAction } from "../actions";
import { NewDraftForm } from "../invoice-forms";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const actor = await requireUser();
  // Phase 28: an invoice is for a customer, so this also needs the customer list.
  if (!can(actor, "invoice.manage") || !can(actor, "customer.view")) return <AccessDenied what="creating invoices" />;
  const { customer } = await searchParams;
  const customers = await listCustomerOptions(actor);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={customer ? `/customers/${customer}` : "/invoices"} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Link>
      <PageHeader title="New invoice" description="Start a draft, then add subscription periods, project amounts or your own lines." />
      <Card>
        <NewDraftForm action={createDraftAction} customers={customers} customerId={customers.some((c) => c.id === customer) ? customer : undefined} />
      </Card>
    </div>
  );
}
