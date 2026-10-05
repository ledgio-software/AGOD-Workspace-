"use client";

import { ActionForm, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import { ALLOWED_EXTENSIONS, formatBytes } from "@/lib/files";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function FileUploadForm({ action, label = "Upload" }: { action: Action; label?: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-center gap-2">
      <input
        name="file"
        type="file"
        required
        accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")}
        className={`${inputClass} w-auto text-xs`}
      />
      <SubmitButton variant="secondary" pendingText="Uploading…">
        {label}
      </SubmitButton>
      <span className="text-xs text-zinc-500">Max 4 MB. PDF, images, Office files, text, CSV or ZIP.</span>
    </ActionForm>
  );
}

/** `remove` is a bound server action, present only when this person may remove the file. */
export type FileItem = { id: string; fileName: string; sizeBytes: number; uploaderName: string; createdAt: string; remove?: Action };

export function FileList({ files }: { files: FileItem[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-2">
          <a href={`/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="underline">
            📎 {f.fileName}
          </a>
          <span className="text-zinc-500">
            {formatBytes(f.sizeBytes)} · {f.uploaderName} · {f.createdAt}
          </span>
          {f.remove && (
            <ActionForm action={f.remove} confirmMessage={`Remove ${f.fileName}?`} className="inline-block">
              <SubmitButton variant="secondary">Remove</SubmitButton>
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}
