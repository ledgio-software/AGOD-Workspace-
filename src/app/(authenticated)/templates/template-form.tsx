"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export const OUTLINE_HELP = `One line per item:
# Milestone name
- Task title | +10d | 12h | optional
"+10d" = due 10 days after the project start, "12h" = estimate, "optional" = not required for approval.`;

export function TemplateForm({
  action,
  defaults,
  submitLabel,
}: {
  action: Action;
  defaults?: { name: string; description: string | null; outline: string; active: boolean };
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required minLength={3} defaultValue={defaults?.name} className={inputClass} />
        </Field>
        <Field label="Description (optional)">
          <input name="description" defaultValue={defaults?.description ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field label="Milestones and tasks" hint={OUTLINE_HELP}>
        <textarea name="outline" required rows={16} defaultValue={defaults?.outline} className={`${inputClass} font-mono`} />
      </Field>
      {defaults && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={defaults.active} /> Active (offered when applying templates)
        </label>
      )}
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export function ApplyTemplateForm({ action, templates }: { action: Action; templates: { id: string; name: string; tasks: number }[] }) {
  if (templates.length === 0) return null;
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Add milestones and tasks from a template">
        <select name="templateId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.tasks} tasks)
            </option>
          ))}
        </select>
      </Field>
      <SubmitButton variant="secondary">Add from template</SubmitButton>
    </ActionForm>
  );
}

export function SaveAsTemplateForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <Field label="Save this project's milestones and tasks as a template">
        <input name="name" required minLength={3} placeholder="Template name" className={inputClass} />
      </Field>
      <SubmitButton variant="secondary">Save as template</SubmitButton>
    </ActionForm>
  );
}
