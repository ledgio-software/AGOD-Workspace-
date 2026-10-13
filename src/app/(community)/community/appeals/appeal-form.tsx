"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import { appealContentAction } from "../actions";

export function ContentAppealForm({ type, id }: { type: string; id: string }) {
  return (
    <ActionForm action={appealContentAction} className="space-y-3">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <Field label="Why should it be shown again?" hint="20 to 2,000 characters. AGOD staff read every appeal.">
        <textarea name="message" required minLength={20} maxLength={2000} rows={4} className={inputClass} />
      </Field>
      <SubmitButton size="sm" pendingText="Sending…">
        Send appeal
      </SubmitButton>
    </ActionForm>
  );
}
