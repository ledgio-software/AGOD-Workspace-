"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import { buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";

// Phase 32: release forms.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export type ReleaseDefaults = {
  title: string;
  versionLabel: string;
  changeSummary: string;
  reason: string;
  securityImpact: "LOW" | "MEDIUM" | "HIGH";
  testEvidence: string;
  rollbackPlan: string;
  emergency: boolean;
};

const empty: ReleaseDefaults = { title: "", versionLabel: "", changeSummary: "", reason: "", securityImpact: "LOW", testEvidence: "", rollbackPlan: "", emergency: false };

export function ReleaseForm({ action, defaults = empty, submitLabel }: { action: Action; defaults?: ReleaseDefaults; submitLabel: string }) {
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Release name">
            <input name="title" required minLength={3} maxLength={200} defaultValue={defaults.title} placeholder="e.g. Mobile money refunds" className={inputClass} />
          </Field>
        </div>
        <Field label="Version (optional)">
          <input name="versionLabel" maxLength={50} defaultValue={defaults.versionLabel} placeholder="e.g. v2.4.0" className={inputClass} />
        </Field>
      </div>
      <Field label="What changes" hint="In plain words, what users or systems will notice.">
        <textarea name="changeSummary" required minLength={10} maxLength={4000} rows={3} defaultValue={defaults.changeSummary} className={inputClass} />
      </Field>
      <Field label="Why">
        <textarea name="reason" required minLength={3} maxLength={2000} rows={2} defaultValue={defaults.reason} placeholder="e.g. Customers asked for refunds to their wallet" className={inputClass} />
      </Field>
      <Field label="How it was tested" hint="Tests run, who tried it, links to test results or the pull request.">
        <textarea name="testEvidence" required minLength={3} maxLength={4000} rows={2} defaultValue={defaults.testEvidence} className={inputClass} />
      </Field>
      <Field label="How to undo it">
        <textarea name="rollbackPlan" required minLength={3} maxLength={2000} rows={2} defaultValue={defaults.rollbackPlan} placeholder="e.g. Redeploy v2.3.1; no database change" className={inputClass} />
      </Field>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">Security impact</legend>
        {(
          [
            ["LOW", "Low", "Text, layout or other changes that don't touch money, logins or personal data."],
            ["MEDIUM", "Medium", "Touches business rules or data, but not logins, permissions or payments."],
            ["HIGH", "High", "Logins, permissions, payments, personal data or secrets. Needs a security check before approval."],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="flex items-start gap-2">
            <input type="radio" name="securityImpact" value={value} defaultChecked={defaults.securityImpact === value} className="mt-1" />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="emergency" defaultChecked={defaults.emergency} className="mt-1" />
        <span>
          <span className="font-medium">Emergency fix</span>
          <span className="block text-xs text-muted">
            Something is broken for customers now. It can go live before approval (still by someone other than you), and a manager approves it afterwards.
          </span>
        </span>
      </label>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

/** One step with an optional or required note. */
export function StepForm({
  action,
  label,
  noteLabel,
  required = false,
  placeholder,
  variant = "primary",
  confirmMessage,
}: {
  action: Action;
  label: string;
  noteLabel?: string;
  required?: boolean;
  placeholder?: string;
  variant?: "primary" | "secondary" | "danger";
  confirmMessage?: string;
}) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage} className="space-y-2">
      {noteLabel && (
        <Field label={noteLabel}>
          <textarea name="note" rows={2} required={required} minLength={required ? 3 : undefined} maxLength={2000} placeholder={placeholder} className={inputClass} />
        </Field>
      )}
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function DecideForm({ action, canApprove }: { action: Action; canApprove: boolean }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <Field label="Note (needed to reject)">
        <textarea name="note" rows={2} maxLength={2000} className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <button type="submit" name="decision" value="approve" className={buttonClass("primary", "sm")}>
            Approve
          </button>
        )}
        <button type="submit" name="decision" value="reject" className={buttonClass("danger", "sm")}>
          Reject
        </button>
      </div>
    </ActionForm>
  );
}
