"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import { contactChannelLabel, customerStatusLabel, customerTypeLabel } from "@/lib/labels";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
type Owner = { id: string; name: string };

type CustomerDefaults = {
  name?: string;
  type?: keyof typeof customerTypeLabel;
  status?: keyof typeof customerStatusLabel;
  ownerId?: string;
  notes?: string | null;
  externalReference?: string | null;
  version?: number;
};

const editableStatuses = Object.entries(customerStatusLabel).filter(([value]) => value !== "ARCHIVED");

export function CustomerForm({
  action,
  owners,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  owners: Owner[];
  defaults?: CustomerDefaults;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      {defaults.version !== undefined && <input type="hidden" name="version" value={defaults.version} />}
      <div className="sm:col-span-2">
        <Field label="Customer name">
          <input name="name" required minLength={2} defaultValue={defaults.name} className={inputClass} />
        </Field>
      </div>
      <Field label="Type">
        <select name="type" defaultValue={defaults.type ?? "COMPANY"} className={inputClass}>
          {Object.entries(customerTypeLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status">
        <select name="status" defaultValue={defaults.status ?? "ACTIVE"} className={inputClass}>
          {editableStatuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Account owner" hint="The PM or Admin responsible for this customer.">
        <select name="ownerId" required defaultValue={defaults.ownerId ?? ""} className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reference (optional)" hint="e.g. the customer number in the accounting system.">
        <input name="externalReference" defaultValue={defaults.externalReference ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes (optional)">
          <textarea name="notes" rows={3} defaultValue={defaults.notes ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ArchiveForm({ action, archived }: { action: Action; archived: boolean }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2">
      {archived && <input type="hidden" name="restore" value="true" />}
      <Field label={archived ? "Why restore it?" : "Why archive it?"}>
        <input name="reason" required minLength={3} className={inputClass} />
      </Field>
      <SubmitButton size="sm" variant={archived ? "secondary" : "danger"}>
        {archived ? "Restore customer" : "Archive customer"}
      </SubmitButton>
    </ActionForm>
  );
}

type ContactDefaults = {
  name?: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredChannel?: keyof typeof contactChannelLabel;
  isPrimary?: boolean;
  isBilling?: boolean;
};

export function ContactForm({
  action,
  defaults = {},
  submitLabel,
  resetOnSuccess = false,
}: {
  action: Action;
  defaults?: ContactDefaults;
  submitLabel: string;
  resetOnSuccess?: boolean;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={resetOnSuccess} className="grid gap-3 sm:grid-cols-2">
      <Field label="Name">
        <input name="name" required minLength={2} defaultValue={defaults.name} className={inputClass} />
      </Field>
      <Field label="Role (optional)">
        <input name="role" placeholder="e.g. Finance manager" defaultValue={defaults.role ?? ""} className={inputClass} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" defaultValue={defaults.email ?? ""} className={inputClass} />
      </Field>
      <Field label="Phone">
        <input name="phone" type="tel" defaultValue={defaults.phone ?? ""} className={inputClass} />
      </Field>
      <Field label="Preferred channel">
        <select name="preferredChannel" defaultValue={defaults.preferredChannel ?? "EMAIL"} className={inputClass}>
          {Object.entries(contactChannelLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap items-end gap-4 pb-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="isPrimary" defaultChecked={defaults.isPrimary} className="size-4 accent-brand-600" />
          Primary contact
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="isBilling" defaultChecked={defaults.isBilling} className="size-4 accent-brand-600" />
          Billing contact
        </label>
      </div>
      <p className="text-xs text-muted sm:col-span-2">Give an email or a phone number (or both).</p>
      <div className="sm:col-span-2">
        <SubmitButton size="sm">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ContactActiveForm({ action, active }: { action: Action; active: boolean }) {
  return (
    <ActionForm action={action} confirmMessage={active ? "Deactivate this contact?" : undefined}>
      <input type="hidden" name="active" value={String(!active)} />
      <SubmitButton size="sm" variant="secondary">
        {active ? "Deactivate" : "Reactivate"}
      </SubmitButton>
    </ActionForm>
  );
}
