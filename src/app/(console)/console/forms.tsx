"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

// Phase 40: back-office forms. Anything that changes someone's access asks for a reason, which
// goes in the back-office log.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
type Bare = (prev: ActionResult | null) => Promise<ActionResult>;

export function ReasonForm({ action, label, confirmMessage, danger = false, placeholder }: { action: Action; label: string; confirmMessage: string; danger?: boolean; placeholder: string }) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage} resetOnSuccess className="space-y-3">
      <Field label="Reason" hint="At least 5 characters. Kept in the back-office log.">
        <input name="reason" required minLength={5} maxLength={500} placeholder={placeholder} className={inputClass} />
      </Field>
      <SubmitButton variant={danger ? "danger" : "primary"} size="sm">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function ConfirmButton({ action, label, confirmMessage, variant = "secondary" }: { action: Bare; label: string; confirmMessage?: string; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage}>
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function OrganizerForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <div className="min-w-60 flex-1">
        <Field label="Make someone an organizer" hint="Their profile address, e.g. ama-mensah or https://…/members/ama-mensah">
          <input name="handle" required maxLength={200} placeholder="ama-mensah" className={inputClass} />
        </Field>
      </div>
      <SubmitButton size="sm">Make organizer</SubmitButton>
    </ActionForm>
  );
}
