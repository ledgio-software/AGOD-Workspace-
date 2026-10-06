import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getInvoiceSettings } from "@/modules/invoices";
import { settingsAction } from "../actions";
import { SettingsForm } from "../invoice-forms";

export default async function InvoiceSettingsPage() {
  const actor = await requireUser();
  if (!can(actor, "invoice.settings")) return <AccessDenied what="invoice settings" />;
  const s = await getInvoiceSettings(actor);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/invoices" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Invoices
      </Link>
      <PageHeader title="Invoice settings" description="Who your company is on its invoices and how customers pay. These details appear on every invoice PDF, including ones already issued." />
      <Card>
        <SettingsForm
          action={settingsAction}
          defaults={{
            businessName: s?.businessName ?? actor.orgName,
            address: s?.address ?? null,
            email: s?.email ?? null,
            phone: s?.phone ?? null,
            taxId: s?.taxId ?? null,
            paymentInstructions: s?.paymentInstructions ?? null,
            footer: s?.footer ?? null,
            defaultDueDays: s?.defaultDueDays ?? 14,
          }}
        />
      </Card>
    </div>
  );
}
