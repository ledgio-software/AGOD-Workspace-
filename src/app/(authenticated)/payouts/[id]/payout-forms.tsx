"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import { adjustmentTypeLabel, paymentMethodLabel } from "@/lib/labels";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function PaymentForm({ action, today, remainingLabel }: { action: Action; today: string; remainingLabel: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-2 sm:items-end">
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
      <div className="sm:col-span-2">
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
      className="grid gap-3 sm:grid-cols-2 sm:items-end"
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
        <p className="text-sm text-muted">Voids the whole payout. Only possible before any payment.</p>
      )}
      <Field label="Reason (required)">
        <input name="reason" required className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton variant={type === "VOID" ? "danger" : "secondary"}>Record adjustment</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function QuestionForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2">
      <Field label="Ask about this payout" hint="The amount is not changed by asking. Your project manager reviews it.">
        <textarea name="question" required minLength={10} rows={3} className={inputClass} />
      </Field>
      <SubmitButton>Send question</SubmitButton>
    </ActionForm>
  );
}

export function ReviewQuestionForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="grid gap-2 sm:grid-cols-3 sm:items-end">
      <Field label="Outcome">
        <select name="outcome" defaultValue="NO_CHANGE" className={inputClass}>
          <option value="NO_CHANGE">Amount is correct (close)</option>
          <option value="NEEDS_ADJUSTMENT">Needs an adjustment (send to Admin)</option>
        </select>
      </Field>
      <Field label="Explanation">
        <input name="note" required minLength={3} className={inputClass} />
      </Field>
      <SubmitButton>Save review</SubmitButton>
    </ActionForm>
  );
}

export function ResolveQuestionForm({ action }: { action: Action }) {
  const [type, setType] = useState<"" | keyof typeof adjustmentTypeLabel>("");
  return (
    <ActionForm
      action={action}
      confirmMessage={type ? "Record this adjustment and resolve the question? Adjustments cannot be edited or deleted." : undefined}
      className="grid gap-2 sm:grid-cols-4 sm:items-end"
    >
      <Field label="Settle with">
        <select name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inputClass}>
          <option value="">No change</option>
          {Object.entries(adjustmentTypeLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {type && type !== "VOID" && (
        <Field label="Amount (GHS)">
          <input name="amount" required inputMode="decimal" className={inputClass} />
        </Field>
      )}
      <Field label="Resolution (shown to the member)">
        <input name="resolution" required minLength={3} className={inputClass} />
      </Field>
      <SubmitButton variant={type === "VOID" ? "danger" : "primary"}>Resolve</SubmitButton>
    </ActionForm>
  );
}
