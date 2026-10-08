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

/** Phase 32: release approvals on or off, always with a reason. */
export function ReleaseControlForm({ action, on }: { action: Action; on: boolean }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      <input type="hidden" name="on" value={String(!on)} />
      <Field label="Reason for the change">
        <input name="reason" required minLength={3} maxLength={500} placeholder={on ? "e.g. We don't ship software for clients" : "e.g. Our bank client asks for change control"} className={inputClass} />
      </Field>
      <SubmitButton variant={on ? "danger" : "primary"} pendingText="Saving…">
        {on ? "Switch release approvals off" : "Switch release approvals on"}
      </SubmitButton>
    </ActionForm>
  );
}

/** Phase 29: deposits, client review time and when the team is paid. */
export function MoneyFlowForm({
  action,
  defaults,
}: {
  action: Action;
  defaults: { defaultDeposit: string; requireDeposit: boolean; clientReviewDays: number; payoutRelease: "ON_APPROVAL" | "ON_CLIENT_PAYMENT" };
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Usual deposit (%)" hint="Used for the 50/50 payment plan; you can change any project's plan.">
          <input name="defaultDeposit" required inputMode="decimal" defaultValue={defaults.defaultDeposit} className={inputClass} />
        </Field>
        <Field label="Working days a client has to review work" hint="Shown as the answer deadline when work is sent for review.">
          <input name="clientReviewDays" type="number" min={1} max={60} required defaultValue={defaults.clientReviewDays} className={inputClass} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="requireDeposit" defaultChecked={defaults.requireDeposit} className="mt-1" />
        <span>
          <span className="font-medium">No deposit, no work</span>
          <span className="block text-xs text-muted">A client project can&apos;t move to In progress until its deposit is paid. A manager can still start it with a written reason.</span>
        </span>
      </label>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">When the team can be paid</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="payoutRelease" value="ON_APPROVAL" defaultChecked={defaults.payoutRelease === "ON_APPROVAL"} className="mt-1" />
          <span>
            As soon as the project is approved
            <span className="block text-xs text-muted">The company pays the team even if the client hasn&apos;t paid yet.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="payoutRelease" value="ON_CLIENT_PAYMENT" defaultChecked={defaults.payoutRelease === "ON_CLIENT_PAYMENT"} className="mt-1" />
          <span>
            In step with what the client has paid
            <span className="block text-xs text-muted">If the client has paid half of a project, up to half of each person&apos;s payout can be paid. Internal projects are paid on approval.</span>
          </span>
        </label>
      </fieldset>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </ActionForm>
  );
}
