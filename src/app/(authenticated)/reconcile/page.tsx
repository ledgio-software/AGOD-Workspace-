import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { ReconcileForm } from "./reconcile-form";

export default async function ReconcilePage() {
  const actor = await requireUser();
  if (!can(actor, "payout.viewAll")) return <AccessDenied what="reconciliation" />;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/ledger" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Ledger
      </Link>
      <PageHeader
        eyebrow="Money"
        title="Reconcile with your spreadsheet"
        description={
          <>
            Compare the amounts you track today with the ledger. Use the columns <code className="rounded bg-surface-muted px-1 text-xs">project_code</code>,{" "}
            <code className="rounded bg-surface-muted px-1 text-xs">recipient_email</code>, <code className="rounded bg-surface-muted px-1 text-xs">expected_owed</code>{" "}
            and optionally <code className="rounded bg-surface-muted px-1 text-xs">expected_paid</code>, in GHS. Amounts are compared after adjustments; voided payouts
            are ignored. Nothing is saved.
          </>
        }
      />
      <Card>
        <ReconcileForm />
      </Card>
    </div>
  );
}
