"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import { adjustmentTypeLabel, paymentMethodLabel } from "@/lib/labels";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function PaymentForm({ action, today, remainingLabel }: { action: Action; today: string; remainingLabel: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-3 sm:items-end">
      <Field label="Amount (GHS)" hint={`Outstanding: ${remainingLabel}`}>
        <input name="amount" required inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="Method">
        <select name="method" required defaultValue="MOBILE_MONEY" className={inputClass}>
          {Object.entries(paymentMethodLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Paid on">
        <input name="paidOn" type="date" required max={today} defaultValue={today} className={inputClass} />
      </Field>
      <Field label="Reference (optional)" hint="e.g. MoMo transaction ID">
        <input name="reference" className={inputClass} />
      </Field>
      <Field label="Evidence link (optional)" hint="Link to the receipt or screenshot">
        <input name="evidenceUrl" type="url" className={inputClass} />
      </Field>
      <Field label="Notes (optional)">
        <input name="notes" className={inputClass} />
      </Field>
      <div className="sm:col-span-3">
        <SubmitButton pendingText="Recording…">Record payment</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AdjustmentForm({ action }: { action: Action }) {
  const [type, setType] = useState<keyof typeof adjustmentTypeLabel>("INCREASE");
  return (
    <ActionForm
      action={action}
      resetOnSuccess
      confirmMessage="Record this adjustment? It cannot be edited or deleted afterwards."
      className="grid gap-3 sm:grid-cols-3 sm:items-end"
    >
      <Field label="Type">
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as keyof typeof adjustmentTypeLabel)}
          className={inputClass}
        >
          {Object.entries(adjustmentTypeLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {type !== "VOID" ? (
        <Field label="Amount (GHS)">
          <input name="amount" required inputMode="decimal" className={inputClass} />
        </Field>
      ) : (
        <p className="text-sm text-zinc-500">Voids the whole payout. Only possible before any payment.</p>
      )}
      <Field label="Reason (required)">
        <input name="reason" required className={inputClass} />
      </Field>
      <div className="sm:col-span-3">
        <SubmitButton variant={type === "VOID" ? "danger" : "secondary"}>Record adjustment</SubmitButton>
      </div>
    </ActionForm>
  );
}
