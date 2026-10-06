"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function CancelSessionForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} confirmMessage="Cancel this session? Everyone who joined gets an email." className="space-y-2">
      <Field label="Why (sent to people who joined)">
        <input name="reason" required minLength={3} maxLength={300} className={inputClass} />
      </Field>
      <SubmitButton size="sm" variant="danger" pendingText="Cancelling…">
        Cancel the session
      </SubmitButton>
    </ActionForm>
  );
}

export function RecordingForm({ action, recordingUrl, notes }: { action: Action; recordingUrl: string | null; notes: string | null }) {
  return (
    <ActionForm action={action} className="space-y-3">
      <Field label="Recording link (optional)" hint="YouTube (unlisted), Loom, Google Drive...">
        <input name="recordingUrl" defaultValue={recordingUrl ?? ""} placeholder="https://" className={inputClass} />
      </Field>
      <Field label="Key notes (optional)" hint="What you covered, links you shared, next steps.">
        <textarea name="notes" rows={4} maxLength={5000} defaultValue={notes ?? ""} className={inputClass} />
      </Field>
      <SubmitButton size="sm" pendingText="Saving…">
        Save
      </SubmitButton>
    </ActionForm>
  );
}
