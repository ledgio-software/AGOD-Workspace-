"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

// Phase 29: forms of the Billing tab.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
type Bare = (prev: ActionResult | null) => Promise<ActionResult>;

export function PresetForm({ action, presets, replacing }: { action: Action; presets: { key: string; label: string }[]; replacing: boolean }) {
  return (
    <ActionForm action={action} confirmMessage={replacing ? "Replace the payments that aren't invoiced yet with this plan?" : undefined} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p.key} type="submit" name="preset" value={p.key} className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm shadow-xs hover:border-brand-500 hover:bg-surface-muted">
            {p.label}
          </button>
        ))}
      </div>
    </ActionForm>
  );
}

export function AddStageForm({ action, milestones }: { action: Action; milestones: { id: string; title: string }[] }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-5 sm:items-end">
      <Field label="Payment">
        <input name="label" required minLength={2} maxLength={120} placeholder="e.g. Design approved" className={inputClass} />
      </Field>
      <Field label="Type">
        <select name="kind" defaultValue="MILESTONE" className={inputClass}>
          <option value="DEPOSIT">Deposit (before work starts)</option>
          <option value="MILESTONE">Milestone payment</option>
          <option value="FINAL">Final payment</option>
        </select>
      </Field>
      <Field label="Amount or %">
        <input name="amount" required placeholder="2500.00 or 30%" className={inputClass} />
      </Field>
      <Field label="For milestone (optional)">
        <select name="milestoneId" defaultValue="" className={inputClass}>
          <option value="">None</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </Field>
      <SubmitButton>Add payment</SubmitButton>
    </ActionForm>
  );
}

export function ButtonForm({ action, label, confirmMessage, variant = "secondary" }: { action: Bare; label: string; confirmMessage?: string; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage}>
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function ReviewForm({ action, today }: { action: Action; today: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Sent to the client for review on">
        <input type="date" name="on" required max={today} defaultValue={today} className={`${inputClass} w-auto`} />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Save
      </SubmitButton>
    </ActionForm>
  );
}

export function SignOffForm({ action, today }: { action: Action; today: string }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Accepted on">
          <input type="date" name="on" required max={today} defaultValue={today} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="How the client accepted">
            <input name="note" required minLength={3} maxLength={1000} placeholder="e.g. Email from Ama, 12 Oct: 'All good, go ahead'" className={inputClass} />
          </Field>
        </div>
      </div>
      <SubmitButton size="sm">Record sign-off</SubmitButton>
    </ActionForm>
  );
}

export function ChangeRequestForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Field label="What the client asked for">
            <input name="title" required minLength={3} maxLength={200} placeholder="e.g. Add Mobile Money checkout" className={inputClass} />
          </Field>
        </div>
        <Field label="Extra price (GHS)" hint="0 if it's free.">
          <input name="amount" required inputMode="decimal" placeholder="2000.00" className={inputClass} />
        </Field>
        <Field label="Extra days">
          <input name="extraDays" type="number" min={0} max={365} defaultValue={0} className={inputClass} />
        </Field>
        <Field label="Details (optional)">
          <input name="description" maxLength={2000} className={inputClass} />
        </Field>
      </div>
      <SubmitButton>Save as draft</SubmitButton>
    </ActionForm>
  );
}

export function DecideForm({ action, today }: { action: Action; today: string }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Decided on">
          <input type="date" name="on" required max={today} defaultValue={today} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="How the client decided">
            <input name="note" required minLength={3} maxLength={1000} placeholder="e.g. Approved on WhatsApp by Kofi" className={inputClass} />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approve" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          Client approved
        </button>
        <button type="submit" name="decision" value="reject" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-muted">
          Client rejected
        </button>
      </div>
    </ActionForm>
  );
}
