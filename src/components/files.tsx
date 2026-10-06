"use client";

import { ExternalLink, Link2, Paperclip } from "lucide-react";
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
        className={`${inputClass} w-full text-xs sm:w-auto file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-fg`}
      />
      <SubmitButton variant="secondary" pendingText="Uploading…">
        {label}
      </SubmitButton>
      <span className="text-xs text-muted">Max 4 MB. PDF, images, Office files, text, CSV or ZIP.</span>
    </ActionForm>
  );
}

/** `remove` is a bound server action, present only when this person may remove the file. */
export type FileItem = { id: string; fileName: string; sizeBytes: number; uploaderName: string; createdAt: string; remove?: Action };

export function FileList({ files }: { files: FileItem[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-xs">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={`/files/${f.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            <Paperclip className="size-3.5" aria-hidden />
            {f.fileName}
          </a>
          <span className="text-muted">
            {formatBytes(f.sizeBytes)} · {f.uploaderName} · {f.createdAt}
          </span>
          {f.remove && (
            <ActionForm action={f.remove} confirmMessage={`Remove ${f.fileName}?`} className="inline-block">
              <SubmitButton variant="secondary" size="sm">
                Remove
              </SubmitButton>
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Phase 21: links to Google Drive files (or other pages). `remove` as for files. */
export type LinkItem = { id: string; url: string; title: string; provider: string; addedByName: string; createdAt: string; remove?: Action };

export function LinkList({ links }: { links: LinkItem[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-xs">
      {links.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 font-medium break-all text-brand-600 hover:underline dark:text-brand-400"
          >
            <Link2 className="size-3.5 shrink-0" aria-hidden />
            {l.title}
            <ExternalLink className="size-3 shrink-0 opacity-60" aria-label="(opens in a new tab)" />
          </a>
          <span className="text-muted">
            {l.provider === "GOOGLE_DRIVE" ? "Google Drive · " : ""}
            {l.addedByName} · {l.createdAt}
          </span>
          {l.remove && (
            <ActionForm action={l.remove} confirmMessage={`Remove the link “${l.title}”? The file itself is not touched.`} className="inline-block">
              <SubmitButton variant="secondary" size="sm">
                Remove
              </SubmitButton>
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AddLinkForm({ action, label = "Add link" }: { action: Action; label?: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-center gap-2">
      <input name="url" type="url" required placeholder="https://docs.google.com/…" aria-label="Link" className={`${inputClass} w-full text-xs sm:w-72`} />
      <input name="title" maxLength={200} placeholder="Title (optional)" aria-label="Title" className={`${inputClass} w-full text-xs sm:w-48`} />
      <SubmitButton variant="secondary" pendingText="Adding…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function DriveFolderButton({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="inline-block">
      <SubmitButton variant="secondary" size="sm" pendingText="Creating…">
        Create the Drive folder
      </SubmitButton>
    </ActionForm>
  );
}
