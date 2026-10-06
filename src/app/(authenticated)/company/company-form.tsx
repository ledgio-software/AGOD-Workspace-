"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function CompanyForm({ action, defaults }: { action: Action; defaults: { name: string; projectCodePrefix: string } }) {
  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="Company name">
        <input name="name" required minLength={2} maxLength={120} defaultValue={defaults.name} className={inputClass} />
      </Field>
      <Field label="Project code prefix" hint={`New projects are numbered ${defaults.projectCodePrefix}-2026-001, ${defaults.projectCodePrefix}-2026-002, … Existing project codes don't change.`}>
        <input
          name="projectCodePrefix"
          required
          pattern="[A-Za-z][A-Za-z0-9]{1,7}"
          title="2 to 8 letters or digits, starting with a letter"
          defaultValue={defaults.projectCodePrefix}
          className={`${inputClass} uppercase`}
        />
      </Field>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </ActionForm>
  );
}
