"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import { createOwnCompanyAction } from "./actions";

export function CreateCompanyForm() {
  return (
    <ActionForm action={createOwnCompanyAction} className="space-y-3 text-left">
      <Field label="Company name">
        <input name="name" required minLength={2} maxLength={120} autoComplete="organization" className={inputClass} />
      </Field>
      <SubmitButton pendingText="Creating…">Create my company</SubmitButton>
    </ActionForm>
  );
}
