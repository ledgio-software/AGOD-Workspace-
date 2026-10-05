import type { Actor } from "@/lib/permissions";
import { listLedger } from "@/modules/ledger";
import { type ReconcileResult, parseSheet, reconcile } from "./reconcile";

/** Reconciles pasted spreadsheet text against the live (non-voided) ledger. Needs payout.viewAll. */
export async function reconcileWithLedger(actor: Actor, text: string): Promise<ReconcileResult> {
  const { rows, errors } = parseSheet(text);
  const { rows: ledger } = await listLedger(actor);
  const system = ledger
    .filter((r) => r.status !== "VOIDED")
    .map((r) => ({
      projectCode: r.projectCode,
      email: r.memberEmail.toLowerCase(),
      memberName: r.memberName,
      owedMinor: r.effectiveOwedMinor,
      paidMinor: r.paidMinor,
    }));
  return { errors, ...reconcile(rows, system) };
}
