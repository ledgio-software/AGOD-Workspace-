"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import { billingCadenceLabel, pricingBasisLabel, subscriptionStatusLabel } from "@/lib/labels";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
type Person = { id: string; name: string };
type Cadence = keyof typeof billingCadenceLabel;
type Basis = keyof typeof pricingBasisLabel;
type Status = keyof typeof subscriptionStatusLabel;

export type TermDefaults = {
  billingCadence?: Cadence;
  price?: string;
  pricingBasis?: Basis;
  quantity?: number;
  endDate?: string | null;
  renewalDate?: string | null;
  noticePeriodDays?: number;
  paymentTerms?: string | null;
};

export type DetailDefaults = {
  ownerId?: string;
  renewalOwnerId?: string | null;
  externalReference?: string | null;
  notes?: string | null;
};

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-4 first:border-0 first:pt-0 sm:col-span-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>
    </div>
  );
}

function Options({ entries }: { entries: [string, string][] }) {
  return entries.map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

/** Price, billing and dates. `cadence`/`price` are controlled so a chosen service can pre-fill them. */
function TermFields({
  defaults,
  cadence,
  onCadence,
  price,
  onPrice,
}: {
  defaults: TermDefaults;
  cadence: Cadence;
  onCadence: (c: Cadence) => void;
  price: string;
  onPrice: (p: string) => void;
}) {
  return (
    <>
      <Field label="Price (GHS)" hint="Per billing period, per unit.">
        <input name="price" required inputMode="decimal" value={price} onChange={(e) => onPrice(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Billing">
        <select name="billingCadence" value={cadence} onChange={(e) => onCadence(e.target.value as Cadence)} className={inputClass}>
          <Options entries={Object.entries(billingCadenceLabel)} />
        </select>
      </Field>
      <Field label="Pricing basis">
        <select name="pricingBasis" defaultValue={defaults.pricingBasis ?? "FIXED"} className={inputClass}>
          <Options entries={Object.entries(pricingBasisLabel)} />
        </select>
      </Field>
      <Field label="Quantity" hint="Seats, sites or units. 1 for a fixed fee.">
        <input name="quantity" type="number" min={1} required defaultValue={defaults.quantity ?? 1} className={inputClass} />
      </Field>
      <Field label="End date (optional)" hint="Leave empty for an open-ended subscription.">
        <input name="endDate" type="date" defaultValue={defaults.endDate ?? ""} className={inputClass} />
      </Field>
      <Field label="Renewal date (optional)" hint="When the next renewal decision is due.">
        <input name="renewalDate" type="date" defaultValue={defaults.renewalDate ?? ""} className={inputClass} />
      </Field>
      <Field label="Notice period (days)" hint="How long before renewal to contact the customer.">
        <input name="noticePeriodDays" type="number" min={0} max={365} required defaultValue={defaults.noticePeriodDays ?? 30} className={inputClass} />
      </Field>
      <Field label="Payment terms (optional)">
        <input name="paymentTerms" placeholder="e.g. Net 14" defaultValue={defaults.paymentTerms ?? ""} className={inputClass} />
      </Field>
    </>
  );
}

function DetailFields({ defaults, owners }: { defaults: DetailDefaults; owners: Person[] }) {
  return (
    <>
      <Field label="Owner">
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
      <Field label="Renewal owner (optional)" hint="Who handles the renewal, if not the owner.">
        <select name="renewalOwnerId" defaultValue={defaults.renewalOwnerId ?? ""} className={inputClass}>
          <option value="">Same as owner</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contract reference (optional)">
        <input name="externalReference" defaultValue={defaults.externalReference ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes (optional)">
          <textarea name="notes" rows={2} defaultValue={defaults.notes ?? ""} className={inputClass} />
        </Field>
      </div>
    </>
  );
}

type ServiceOption = { id: string; code: string; name: string; defaultCadence: Cadence; defaultPriceMinor: number | null };
const toInput = (minor: number) => (minor / 100).toFixed(2);

export function NewSubscriptionForm({
  action,
  customers,
  services,
  owners,
  defaults,
}: {
  action: Action;
  customers: Person[];
  services: ServiceOption[];
  owners: Person[];
  defaults: { customerId?: string; ownerId: string; startDate: string };
}) {
  const [cadence, setCadence] = useState<Cadence>("MONTHLY");
  const [price, setPrice] = useState("");
  const [activate, setActivate] = useState("true");

  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      <Heading>Customer and service</Heading>
      <Field label="Customer">
        <select name="customerId" required defaultValue={defaults.customerId ?? ""} className={inputClass}>
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
      <Field label="Service" hint="Its default price and billing are copied in; change them to what was agreed.">
        <select
          name="serviceId"
          required
          defaultValue=""
          onChange={(e) => {
            const s = services.find((x) => x.id === e.target.value);
            if (!s) return;
            setCadence(s.defaultCadence);
            if (s.defaultPriceMinor !== null) setPrice(toInput(s.defaultPriceMinor));
          }}
          className={inputClass}
        >
          <option value="" disabled>
            Choose…
          </option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Start date">
        <input name="startDate" type="date" required defaultValue={defaults.startDate} className={inputClass} />
      </Field>
      <Field label="Status">
        <select name="activate" value={activate} onChange={(e) => setActivate(e.target.value)} className={inputClass}>
          <option value="true">Active (agreed with the customer)</option>
          <option value="false">Draft (still being negotiated)</option>
        </select>
      </Field>
      <Heading>Terms</Heading>
      <TermFields defaults={{}} cadence={cadence} onCadence={setCadence} price={price} onPrice={setPrice} />
      <Heading>People and reference</Heading>
      <DetailFields defaults={{ ownerId: defaults.ownerId }} owners={owners} />
      <div className="sm:col-span-2">
        <SubmitButton>{activate === "true" ? "Create subscription" : "Save draft"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DraftEditForm({
  action,
  owners,
  defaults,
}: {
  action: Action;
  owners: Person[];
  defaults: TermDefaults & DetailDefaults & { startDate: string; version: number };
}) {
  const [cadence, setCadence] = useState<Cadence>(defaults.billingCadence ?? "MONTHLY");
  const [price, setPrice] = useState(defaults.price ?? "");
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="version" value={defaults.version} />
      <Field label="Start date">
        <input name="startDate" type="date" required defaultValue={defaults.startDate} className={inputClass} />
      </Field>
      <div />
      <TermFields defaults={defaults} cadence={cadence} onCadence={setCadence} price={price} onPrice={setPrice} />
      <DetailFields defaults={defaults} owners={owners} />
      <div className="sm:col-span-2">
        <SubmitButton>Save draft</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AmendForm({ action, defaults, today }: { action: Action; defaults: TermDefaults & { version: number }; today: string }) {
  const [cadence, setCadence] = useState<Cadence>(defaults.billingCadence ?? "MONTHLY");
  const [price, setPrice] = useState(defaults.price ?? "");
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="version" value={defaults.version} />
      <p className="text-sm text-muted sm:col-span-2">
        Change the terms that were agreed. The old values are kept in the amendment history.
      </p>
      <TermFields defaults={defaults} cadence={cadence} onCadence={setCadence} price={price} onPrice={setPrice} />
      <Field label="Takes effect on">
        <input name="effectiveDate" type="date" required defaultValue={today} className={inputClass} />
      </Field>
      <Field label="Reason">
        <input name="reason" required minLength={3} placeholder="e.g. Price increase agreed for 2027" className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Record amendment</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DetailsForm({ action, owners, defaults }: { action: Action; owners: Person[]; defaults: DetailDefaults & { version: number } }) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="version" value={defaults.version} />
      <DetailFields defaults={defaults} owners={owners} />
      <div className="sm:col-span-2">
        <SubmitButton size="sm">Save details</SubmitButton>
      </div>
    </ActionForm>
  );
}

const transitionLabel: Record<Status, string> = {
  ACTIVE: "Activate",
  PAUSED: "Pause",
  ENDED: "End",
  CANCELLED: "Cancel",
  DRAFT: "Back to draft",
};

export function StatusForm({ action, allowed, version, from }: { action: Action; allowed: Status[]; version: number; from: Status }) {
  const [to, setTo] = useState<Status>(allowed[0]);
  const needsReason = to === "PAUSED" || to === "ENDED" || to === "CANCELLED";
  return (
    <ActionForm
      action={action}
      resetOnSuccess
      className="flex flex-wrap items-end gap-2"
      confirmMessage={to === "ENDED" || to === "CANCELLED" ? "This is final: an ended or cancelled subscription can't be changed. Continue?" : undefined}
    >
      <input type="hidden" name="version" value={version} />
      <label className="space-y-1.5 text-sm">
        <span className="block font-medium">Change status</span>
        <select name="to" value={to} onChange={(e) => setTo(e.target.value as Status)} className={`${inputClass} w-auto`}>
          {allowed.map((s) => (
            <option key={s} value={s}>
              {from === "PAUSED" && s === "ACTIVE" ? "Resume" : transitionLabel[s]}
            </option>
          ))}
        </select>
      </label>
      {needsReason && <input name="reason" required minLength={3} placeholder="Reason" aria-label="Reason" className={`${inputClass} sm:w-72`} />}
      <SubmitButton size="md" variant={to === "ENDED" || to === "CANCELLED" ? "danger" : "primary"}>
        Apply
      </SubmitButton>
    </ActionForm>
  );
}

export function ServiceForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  defaults?: { code?: string; name?: string; description?: string | null; defaultCadence?: Cadence; defaultPrice?: string; version?: number };
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={defaults.version === undefined} className="grid gap-3 sm:grid-cols-2">
      {defaults.version !== undefined && <input type="hidden" name="version" value={defaults.version} />}
      <Field label="Code" hint="Short and stable, e.g. HOSTING-STD.">
        <input name="code" required defaultValue={defaults.code} className={`${inputClass} uppercase`} />
      </Field>
      <Field label="Name">
        <input name="name" required defaultValue={defaults.name} className={inputClass} />
      </Field>
      <Field label="Default billing">
        <select name="defaultCadence" defaultValue={defaults.defaultCadence ?? "MONTHLY"} className={inputClass}>
          <Options entries={Object.entries(billingCadenceLabel)} />
        </select>
      </Field>
      <Field label="Default price (GHS, optional)" hint="Copied into new subscriptions; each can be negotiated.">
        <input name="defaultPrice" inputMode="decimal" defaultValue={defaults.defaultPrice ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description (optional)">
          <textarea name="description" rows={2} defaultValue={defaults.description ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton size="sm">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ServiceActiveForm({ action, active }: { action: Action; active: boolean }) {
  return (
    <ActionForm action={action} confirmMessage={active ? "Retire this service? Existing subscriptions keep it." : undefined}>
      <input type="hidden" name="active" value={String(!active)} />
      <SubmitButton size="sm" variant="secondary">
        {active ? "Retire" : "Offer again"}
      </SubmitButton>
    </ActionForm>
  );
}

export function RenewForm({
  action,
  defaults,
}: {
  action: Action;
  defaults: { renewalDate: string; endDate: string | null; price: string; hasEndDate: boolean; version: number };
}) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="version" value={defaults.version} />
      <p className="text-sm text-muted sm:col-span-2">
        Record what the customer agreed. The dates are moved forward by one billing period; change them if needed. The previous terms stay in the history.
      </p>
      <Field label="Next renewal date">
        <input name="renewalDate" type="date" required defaultValue={defaults.renewalDate} className={inputClass} />
      </Field>
      <Field label={defaults.hasEndDate ? "New end date" : "End date (optional)"} hint={defaults.hasEndDate ? undefined : "Leave empty to stay open-ended."}>
        <input name="endDate" type="date" defaultValue={defaults.endDate ?? ""} className={inputClass} />
      </Field>
      <Field label="Price (GHS)" hint="Change it only if a new price was agreed.">
        <input name="price" required inputMode="decimal" defaultValue={defaults.price} className={inputClass} />
      </Field>
      <Field label="What was agreed">
        <input name="reason" required minLength={3} placeholder="e.g. Renewed for 2027 by email, same terms" className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Record renewal</SubmitButton>
      </div>
    </ActionForm>
  );
}
