"use server";

import { type ActionResult, runAction } from "@/lib/action-result";
import { requireUser } from "@/lib/session";
import type { ReconcileResult } from "@/modules/reports/reconcile";
import { reconcileWithLedger } from "@/modules/reports/reconcile-ledger";

export async function reconcileAction(_prev: ActionResult<ReconcileResult> | null, form: FormData): Promise<ActionResult<ReconcileResult>> {
  const actor = await requireUser();
  return runAction(() => reconcileWithLedger(actor, String(form.get("sheet") ?? "").slice(0, 500_000)));
}
