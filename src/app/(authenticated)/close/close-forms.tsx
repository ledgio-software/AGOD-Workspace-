"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function ClosePeriodForm({ action, period, warning }: { action: Action; period: string; warning: string | null }) {
  return (
    <ActionForm
      action={action}
      confirmMessage={`Close ${period}? Payments dated in ${period} will be refused until an Admin reopens it.${warning ? `\n\n${warning}` : ""}`}
      className="flex flex-wrap items-end gap-2"
    >
      <Field label="Note (optional)">
        <input name="note" className={`${inputClass} w-full sm:w-80`} placeholder="e.g. Reviewed with the finance lead" />
      </Field>
      <SubmitButton>Close {period}</SubmitButton>
    </ActionForm>
  );
}

export function ReopenPeriodForm({ action, period }: { action: Action; period: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Reason for reopening (required)">
        <input name="reason" required minLength={3} className={`${inputClass} w-full sm:w-80`} />
      </Field>
      <SubmitButton variant="danger">Reopen {period}</SubmitButton>
    </ActionForm>
  );
}
