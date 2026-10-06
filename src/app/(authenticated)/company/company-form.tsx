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

export function SelfApprovalForm({ action, allow }: { action: Action; allow: boolean }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      <input type="hidden" name="allow" value={String(!allow)} />
      <Field label="Reason for the change">
        <input name="reason" required minLength={3} maxLength={500} placeholder={allow ? "e.g. We now have a second manager" : "e.g. I'm the only manager for now"} className={inputClass} />
      </Field>
      <SubmitButton variant={allow ? "primary" : "danger"} pendingText="Saving…">
        {allow ? "Require two people" : "Allow one person (small team)"}
      </SubmitButton>
    </ActionForm>
  );
}
