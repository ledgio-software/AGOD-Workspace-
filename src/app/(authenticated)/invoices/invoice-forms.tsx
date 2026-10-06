"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import { formatMoney } from "@/lib/money";
import { paymentMethodLabel } from "@/lib/labels";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
type Plain = () => Promise<ActionResult>;

const wrapPlain = (action: Plain): Action => () => action();

export function NewDraftForm({ action, customers, customerId }: { action: Action; customers: { id: string; name: string }[]; customerId?: string }) {
  return (
    <ActionForm action={action} className="grid gap-4">
      <Field label="Customer">
        <select name="customerId" required defaultValue={customerId ?? ""} className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes (optional)" hint="Printed on the invoice, e.g. a purchase order number.">
        <textarea name="notes" rows={2} className={inputClass} />
      </Field>
      <div>
        <SubmitButton>Create draft</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PrepareForm({ action, through }: { action: Action; through: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2" confirmMessage="Create drafts for every subscription that is due to be billed? Nothing is sent until you issue each one.">
      <label className="space-y-1 text-xs font-medium text-muted">
        <span className="block">Bill periods starting by</span>
        <input type="date" name="through" defaultValue={through} className={`${inputClass} w-auto py-1.5`} />
      </label>
      <SubmitButton size="sm" variant="secondary">
        Prepare subscription invoices
      </SubmitButton>
    </ActionForm>
  );
}

export function InvoiceSubscriptionButton({ action }: { action: Plain }) {
  return (
    <ActionForm action={wrapPlain(action)}>
      <SubmitButton size="sm" variant="secondary">
        Invoice next period
      </SubmitButton>
    </ActionForm>
  );
}

export function LineForm({ action, projects }: { action: Action; projects: { id: string; code: string; name: string; totalValueMinor: number; billedMinor: number }[] }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-3">
        <Field label="Description">
          <input name="description" required minLength={2} placeholder="e.g. Website deposit (60%)" className={inputClass} />
        </Field>
      </div>
      <Field label="Quantity">
        <input name="quantity" type="number" min={1} defaultValue={1} required className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Unit price (GHS)">
          <input name="unitPrice" required inputMode="decimal" className={inputClass} />
        </Field>
      </div>
      {projects.length > 0 && (
        <div className="sm:col-span-4">
          <Field label="Bills a project (optional)" hint="Checks the total billed against the project's value.">
            <select name="projectId" defaultValue="" className={inputClass}>
              <option value="">Not linked to a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name} ({formatMoney(p.billedMinor)} of {formatMoney(p.totalValueMinor)} billed)
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <div className="sm:col-span-6">
        <SubmitButton size="sm">Add line</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PeriodForm({ action, subscriptions }: { action: Action; subscriptions: { id: string; serviceName: string; next: { start: string; end: string } | null }[] }) {
  const billable = subscriptions.filter((s) => s.next);
  if (billable.length === 0) return <p className="text-sm text-muted">No subscription has an unbilled period.</p>;
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 space-y-1.5 text-sm sm:max-w-md">
        <span className="block font-medium">Subscription period</span>
        <select name="subscriptionId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {billable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.serviceName} · {s.next!.start === s.next!.end ? s.next!.start : `${s.next!.start} to ${s.next!.end}`}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton size="sm">Add period</SubmitButton>
    </ActionForm>
  );
}

export function RemoveLineButton({ action }: { action: Plain }) {
  return (
    <ActionForm action={wrapPlain(action)}>
      <SubmitButton size="sm" variant="secondary">
        Remove
      </SubmitButton>
    </ActionForm>
  );
}

export function NotesForm({ action, notes, version }: { action: Action; notes: string | null; version: number }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <input type="hidden" name="version" value={version} />
      <Field label="Notes (printed on the invoice)">
        <textarea name="notes" rows={2} defaultValue={notes ?? ""} className={inputClass} />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Save notes
      </SubmitButton>
    </ActionForm>
  );
}

export function IssueForm({ action, version, issueDate, dueDate, billTo }: { action: Action; version: number; issueDate: string; dueDate: string; billTo: string | null }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-3" confirmMessage="Issue this invoice? It gets its number and can't be edited afterwards (only voided).">
      <input type="hidden" name="version" value={version} />
      <label className="space-y-1.5 text-sm">
        <span className="block font-medium">Issue date</span>
        <input name="issueDate" type="date" required defaultValue={issueDate} className={`${inputClass} w-auto`} />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block font-medium">Due date</span>
        <input name="dueDate" type="date" required defaultValue={dueDate} className={`${inputClass} w-auto`} />
      </label>
      <SubmitButton>Issue invoice</SubmitButton>
      <p className="basis-full text-xs text-muted">{billTo ? `Will be addressed to ${billTo}.` : "The customer has no contact with an email: add one to be able to email the invoice."}</p>
    </ActionForm>
  );
}

export function DeleteDraftButton({ action }: { action: Plain }) {
  return (
    <ActionForm action={wrapPlain(action)} confirmMessage="Delete this draft? Nothing has been sent.">
      <SubmitButton size="sm" variant="danger">
        Delete draft
      </SubmitButton>
    </ActionForm>
  );
}

export function VoidForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess confirmMessage="Void this invoice? This can't be undone.">
      <div className="flex flex-wrap items-end gap-2">
        <input name="reason" required minLength={3} placeholder="Why is it being voided?" aria-label="Reason" className={`${inputClass} sm:w-80`} />
        <SubmitButton size="sm" variant="danger">
          Void invoice
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PaymentForm({ action, balance, today }: { action: Action; balance: string; today: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-4">
      <Field label="Amount (GHS)" hint={`Up to ${balance}.`}>
        <input name="amount" required inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="Received on">
        <input name="paidOn" type="date" required defaultValue={today} max={today} className={inputClass} />
      </Field>
      <Field label="Method">
        <select name="method" defaultValue="MOBILE_MONEY" className={inputClass}>
          {Object.entries(paymentMethodLabel).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reference (optional)">
        <input name="reference" className={inputClass} />
      </Field>
      <div className="sm:col-span-4">
        <Field label="Note (optional)">
          <input name="note" className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-4">
        <SubmitButton size="sm">Record payment</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function VoidPaymentForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex items-center gap-2" confirmMessage="Void this payment?">
      <input name="reason" required minLength={3} placeholder="Reason" aria-label="Reason" className={`${inputClass} w-44 py-1 text-xs`} />
      <SubmitButton size="sm" variant="secondary">
        Void
      </SubmitButton>
    </ActionForm>
  );
}

export function SendForm({ action, defaultTo, sentTo, canSend }: { action: Action; defaultTo: string | null; sentTo: string | null; canSend: boolean }) {
  const [custom, setCustom] = useState(false);
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      {custom || !defaultTo ? (
        <label className="space-y-1.5 text-sm">
          <span className="block font-medium">Send to</span>
          <input name="to" type="email" required defaultValue={defaultTo ?? ""} placeholder="name@company.com" className={`${inputClass} sm:w-72`} />
        </label>
      ) : (
        <p className="text-sm">
          Email the PDF to <strong>{defaultTo}</strong>{" "}
          <button type="button" onClick={() => setCustom(true)} className="text-xs text-brand-600 hover:underline dark:text-brand-400">
            use another address
          </button>
        </p>
      )}
      {canSend ? <SubmitButton size="sm" variant="secondary" pendingText="Sending…">{sentTo ? "Send again" : "Send by email"}</SubmitButton> : <p className="text-xs text-muted">Email isn&apos;t set up on this environment.</p>}
    </ActionForm>
  );
}

type SettingsDefaults = {
  businessName: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  paymentInstructions: string | null;
  footer: string | null;
  defaultDueDays: number;
};

export function SettingsForm({ action, defaults }: { action: Action; defaults: SettingsDefaults }) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Business name">
        <input name="businessName" required defaultValue={defaults.businessName} className={inputClass} />
      </Field>
      <Field label="Tax ID (optional)">
        <input name="taxId" defaultValue={defaults.taxId ?? ""} className={inputClass} />
      </Field>
      <Field label="Email (optional)">
        <input name="email" type="email" defaultValue={defaults.email ?? ""} className={inputClass} />
      </Field>
      <Field label="Phone (optional)">
        <input name="phone" defaultValue={defaults.phone ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Address (optional)">
          <textarea name="address" rows={2} defaultValue={defaults.address ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="How to pay" hint="Printed on every unpaid invoice and in the email: bank details, Mobile Money number…">
          <textarea name="paymentInstructions" rows={3} defaultValue={defaults.paymentInstructions ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field label="Default payment terms (days)" hint="Due date = issue date + this many days.">
        <input name="defaultDueDays" type="number" min={0} max={120} required defaultValue={defaults.defaultDueDays} className={inputClass} />
      </Field>
      <Field label="Footer (optional)">
        <input name="footer" defaultValue={defaults.footer ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Save settings</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SaveToDriveButton({ action }: { action: Plain }) {
  return (
    <ActionForm action={wrapPlain(action)}>
      <SubmitButton variant="secondary" pendingText="Saving…">
        Save to Drive
      </SubmitButton>
    </ActionForm>
  );
}
