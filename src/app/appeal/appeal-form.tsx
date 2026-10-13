"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import { appealLoginAction } from "./actions";

export function AppealForm() {
  return (
    <ActionForm action={appealLoginAction} resetOnSuccess className="space-y-4">
      <Field label="Email you sign in with">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Why should we look again?" hint="Say what you think went wrong. 20 to 2,000 characters.">
        <textarea name="message" required minLength={20} maxLength={2000} rows={6} className={inputClass} />
      </Field>
      <SubmitButton pendingText="Sending…">Send my appeal</SubmitButton>
    </ActionForm>
  );
}
