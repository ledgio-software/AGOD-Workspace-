"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function RequestApprovalForm({ action }: { action: Action }) {
  return (
    <ActionForm
      action={action}
      confirmMessage="Request approval? The project is locked for editing until a manager approves it or returns it."
      className="flex flex-wrap items-end gap-2"
    >
      <div className="w-full sm:w-96">
        <Field label="Note for the approver (optional)">
          <input name="note" className={inputClass} />
        </Field>
      </div>
      <SubmitButton>Request approval</SubmitButton>
    </ActionForm>
  );
}

export function ApproveForm({
  action,
  expectedVersion,
  needsOverride,
  totalLabel,
}: {
  action: Action;
  expectedVersion: number;
  needsOverride: boolean;
  totalLabel: string;
}) {
  return (
    <ActionForm
      action={action}
      confirmMessage={`Approve this project? This freezes the compensation snapshot and creates payouts totalling ${totalLabel}. It can only be undone by an Admin reopening the project.`}
      className="space-y-2"
    >
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      {needsOverride && (
        <Field label="Override reason (required: some required tasks are not done)">
          <input name="overrideReason" required className={inputClass} />
        </Field>
      )}
      <SubmitButton pendingText="Approving…">Approve and create payouts</SubmitButton>
    </ActionForm>
  );
}

export function RejectForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <Field label="Return for changes">
        <input name="reason" required placeholder="What needs to change?" className={inputClass} />
      </Field>
      <SubmitButton variant="secondary">Return for changes</SubmitButton>
    </ActionForm>
  );
}

export function ReopenForm({ action }: { action: Action }) {
  return (
    <ActionForm
      action={action}
      confirmMessage="Reopen this project? All its payouts will be voided and it must be approved again."
      className="space-y-2"
    >
      <Field label="Reopen (Admin only)">
        <input name="reason" required placeholder="Why must this project be reopened?" className={inputClass} />
      </Field>
      <SubmitButton variant="danger">Reopen project</SubmitButton>
    </ActionForm>
  );
}
