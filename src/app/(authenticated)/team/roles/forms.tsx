"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import type { PermissionGroup, PermissionKey } from "@/lib/permissions";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
type Bare = (prev: ActionResult | null) => Promise<ActionResult>;

export function TeamTypeForm({ action, options }: { action: Action; options: { value: string; label: string; hint: string }[] }) {
  return (
    <ActionForm action={action} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.value}
            type="submit"
            name="teamType"
            value={o.value}
            className="rounded-lg border border-line bg-surface p-3 text-left text-sm shadow-xs hover:border-brand-500 hover:bg-surface-muted"
          >
            <span className="block font-medium">{o.label}</span>
            <span className="mt-1 block text-xs text-muted">{o.hint}</span>
          </button>
        ))}
      </div>
    </ActionForm>
  );
}

export function CreateRoleForm({ action, sources }: { action: Action; sources: { ref: string; name: string }[] }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Field label="Name">
        <input name="name" required minLength={2} maxLength={60} placeholder="e.g. Finance" className={inputClass} />
      </Field>
      <Field label="Start from">
        <select name="copyFrom" required defaultValue="TEAM_MEMBER" className={inputClass}>
          {sources.map((s) => (
            <option key={s.ref} value={s.ref}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What it's for (optional)">
        <input name="description" maxLength={300} className={inputClass} />
      </Field>
      <SubmitButton>Make role</SubmitButton>
    </ActionForm>
  );
}

export function EditRoleForm({
  action,
  role,
  groups,
}: {
  action: Action;
  role: { name: string; description: string | null; permissions: PermissionKey[] };
  /** The groups this role's starting point allows. */
  groups: PermissionGroup[];
}) {
  return (
    <ActionForm action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required minLength={2} maxLength={60} defaultValue={role.name} className={inputClass} />
        </Field>
        <Field label="What it's for (optional)">
          <input name="description" maxLength={300} defaultValue={role.description ?? ""} className={inputClass} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What people with this role can do</legend>
        {groups.length === 0 && <p className="text-sm text-muted">This role starts from Team Member: there is nothing extra to switch on.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <label key={g.key} className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-sm">
              <input type="checkbox" name="permissions" value={g.key} defaultChecked={role.permissions.includes(g.key)} className="mt-1" />
              <span>
                <span className="font-medium">{g.label}</span>
                {g.money && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">money</span>}
                <span className="block text-xs text-muted">{g.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton size="sm">Save role</SubmitButton>
    </ActionForm>
  );
}

export function SmallButtonForm({ action, label, confirmMessage, variant = "secondary" }: { action: Bare; label: string; confirmMessage?: string; variant?: "secondary" | "danger" }) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage}>
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function AddTitleForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <Field label="New job title">
          <input name="name" required minLength={2} maxLength={60} placeholder="e.g. Data analyst" className={inputClass} />
        </Field>
      </div>
      <SubmitButton>Add</SubmitButton>
    </ActionForm>
  );
}

export function RenameTitleForm({ action, name }: { action: Action; name: string }) {
  return (
    <ActionForm action={action} className="flex items-center gap-2">
      <input name="name" required minLength={2} maxLength={60} defaultValue={name} aria-label="Job title" className={`${inputClass} py-1`} />
      <SubmitButton size="sm" variant="secondary">
        Save
      </SubmitButton>
    </ActionForm>
  );
}
