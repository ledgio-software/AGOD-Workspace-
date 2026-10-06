"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import { ImageInput } from "@/components/image-input";
import type { ActionResult } from "@/lib/action-result";

// Phase 26: small forms on a project page.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function ReviewForm({ action, areas }: { action: Action; areas: string[] }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      {areas.length > 0 && <p className="text-sm text-muted">They asked about: {areas.join(", ")}.</p>}
      <Field label="What works">
        <textarea name="whatWorks" required minLength={10} maxLength={1500} rows={3} className={inputClass} />
      </Field>
      <Field label="One or two things to improve (optional)" hint="Specific problems, not ten. For AI-built projects check the basics: exposed keys, missing input checks, no login on private pages.">
        <textarea name="toImprove" maxLength={1500} rows={3} className={inputClass} />
      </Field>
      <Field label="A next step they can take today">
        <textarea name="nextStep" required minLength={10} maxLength={1000} rows={2} className={inputClass} />
      </Field>
      <p className="text-xs text-muted">Critique the work, never the person.</p>
      <SubmitButton pendingText="Sending…">Send feedback</SubmitButton>
    </ActionForm>
  );
}

export function ReplyForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2">
      <Field label="Your reply">
        <textarea name="reply" required minLength={2} maxLength={1000} rows={2} className={inputClass} />
      </Field>
      <SubmitButton size="sm" variant="secondary" pendingText="Sending…">
        Reply
      </SubmitButton>
    </ActionForm>
  );
}

export function ScreenshotForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-end gap-3">
      <Field label="Add a screenshot" hint="PNG, JPG, WebP or GIF. Made smaller before upload.">
        <ImageInput name="screenshot" required />
      </Field>
      <SubmitButton size="sm" variant="secondary" pendingText="Uploading…">
        Upload
      </SubmitButton>
    </ActionForm>
  );
}

/** A one-button action (status, remove, show again). */
export function ButtonForm({ action, label, confirmMessage, variant = "secondary" }: { action: Action; label: string; confirmMessage?: string; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage}>
      <SubmitButton size="sm" variant={variant} pendingText="Saving…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
