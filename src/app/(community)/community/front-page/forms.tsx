"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import { ImageInput } from "@/components/image-input";
import type { ActionResult } from "@/lib/action-result";

// Phase 35: the front page forms.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function PhotoForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      <Field label="Photo" hint="A wide photo works best (landscape). It's made smaller before upload.">
        <ImageInput name="photo" required />
      </Field>
      <Field label="What the photo shows" hint="Read out by screen readers, e.g. Members building at the Accra meet-up.">
        <input name="alt" required minLength={3} maxLength={200} className={inputClass} />
      </Field>
      <SubmitButton pendingText="Uploading…">Add photo</SubmitButton>
    </ActionForm>
  );
}

export function VideoForm({ action, defaults }: { action: Action; defaults: { url: string; title: string } }) {
  return (
    <ActionForm action={action} className="space-y-3">
      <Field label="Video link" hint="YouTube, Vimeo, Loom or Google Drive (shared so anyone with the link can view). Leave empty to remove the video.">
        <input name="url" defaultValue={defaults.url} placeholder="https://www.youtube.com/watch?v=…" className={inputClass} />
      </Field>
      <Field label="Title (optional)">
        <input name="title" maxLength={120} defaultValue={defaults.title} placeholder="e.g. What Ghana Vibe Coders is about" className={inputClass} />
      </Field>
      <SubmitButton>Save video</SubmitButton>
    </ActionForm>
  );
}
