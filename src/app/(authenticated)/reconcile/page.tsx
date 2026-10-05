import { AccessDenied } from "@/components/access-denied";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { ReconcileForm } from "./reconcile-form";

export default async function ReconcilePage() {
  const actor = await requireUser();
  if (!can(actor, "payout.viewAll")) return <AccessDenied what="reconciliation" />;
  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Reconcile with your spreadsheet</h1>
        <p className="text-sm text-zinc-500">
          During the pilot, compare the amounts you track today with the ledger. Use the columns{" "}
          <code>project_code</code>, <code>recipient_email</code>, <code>expected_owed</code> and optionally{" "}
          <code>expected_paid</code>, in GHS. Amounts are compared after adjustments; voided payouts are ignored. Nothing is
          saved.
        </p>
      </div>
      <ReconcileForm />
    </div>
  );
}
