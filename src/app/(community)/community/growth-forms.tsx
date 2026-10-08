"use client";

import { useState } from "react";
import { Check, Copy, Trophy } from "lucide-react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

// Phase 31: forms for mentorship, the library and project of the month.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
type Bare = (prev: ActionResult | null) => Promise<ActionResult>;

export function MentorSettingsForm({ action, defaults }: { action: Action; defaults: { open: boolean; capacity: number; note: string } }) {
  return (
    <ActionForm action={action} className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="open" defaultChecked={defaults.open} className="mt-1" />
        <span>
          <span className="font-medium">I&apos;m open to mentoring</span>
          <span className="block text-xs text-muted">You appear on the Mentors page. Members ask you with a goal; you accept or decline.</span>
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="How many people at once">
          <select name="capacity" defaultValue={String(defaults.capacity)} className={inputClass}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="What you can help with">
            <input name="note" maxLength={300} defaultValue={defaults.note} placeholder="e.g. Shipping your first app with Lovable; safe logins; job interviews" className={inputClass} />
          </Field>
        </div>
      </div>
      <SubmitButton>Save</SubmitButton>
    </ActionForm>
  );
}

export function AskMentorForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2">
      <Field label="What do you want help with?">
        <textarea name="goal" required minLength={10} maxLength={500} rows={3} placeholder="e.g. I built a MoMo sales tracker with Lovable and want to make the login safe before I share it." className={inputClass} />
      </Field>
      <SubmitButton size="sm" pendingText="Sending…">
        Ask to be mentored
      </SubmitButton>
    </ActionForm>
  );
}

export function AnswerForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <Field label="Note (optional)">
        <input name="note" maxLength={500} placeholder="e.g. Let's start with a 30-minute call next week" className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="answer" value="accept" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          Accept
        </button>
        <button type="submit" name="answer" value="decline" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-muted">
          Decline
        </button>
      </div>
    </ActionForm>
  );
}

export function ButtonForm({ action, label, confirmMessage, variant = "secondary" }: { action: Bare; label: React.ReactNode; confirmMessage?: string; variant?: "primary" | "secondary" | "danger" }) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage}>
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function LibraryItemForm({
  action,
  defaults,
  submitLabel,
}: {
  action: Action;
  defaults?: { kind: string; title: string; summary: string; url: string; body: string; tags: string; lowData: boolean; free: boolean };
  submitLabel: string;
}) {
  const [kind, setKind] = useState(defaults?.kind ?? "PROMPT");
  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="What are you sharing?">
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
          <option value="PROMPT">A prompt that worked</option>
          <option value="TOOL">A tool</option>
          <option value="GUIDE">A guide or tutorial</option>
        </select>
      </Field>
      <Field label="Name">
        <input name="title" required minLength={3} maxLength={120} defaultValue={defaults?.title} placeholder={kind === "PROMPT" ? "e.g. Safe login checklist" : "e.g. Hoppscotch"} className={inputClass} />
      </Field>
      <Field label="What it's good for" hint="One or two sentences.">
        <textarea name="summary" required minLength={10} maxLength={300} rows={2} defaultValue={defaults?.summary} className={inputClass} />
      </Field>
      {kind === "PROMPT" ? (
        <Field label="The prompt" hint="Never include passwords, keys or anyone's personal data.">
          <textarea name="body" required maxLength={4000} rows={8} defaultValue={defaults?.body} className={`${inputClass} font-mono`} />
        </Field>
      ) : (
        <Field label="Link">
          <input name="url" required defaultValue={defaults?.url} placeholder="https://" className={inputClass} />
        </Field>
      )}
      <Field label="Tags (optional)" hint="Separate with commas, e.g. Lovable, Security, Payments.">
        <input name="tags" maxLength={300} defaultValue={defaults?.tags} className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="lowData" defaultChecked={defaults?.lowData} /> Works on a slow or costly connection
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="free" defaultChecked={defaults?.free} /> Free to use
        </label>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked: the text is still there to select.
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-surface-muted"
    >
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Copied" : "Copy prompt"}
    </button>
  );
}

export function VoteButton({ action, voted, votes }: { action: Bare; voted: boolean; votes: number }) {
  return (
    <ActionForm action={action}>
      <SubmitButton size="sm" variant={voted ? "primary" : "secondary"} pendingText="Saving…">
        <Trophy className="size-4" aria-hidden /> {voted ? "Your vote this month" : "Vote for project of the month"} · {votes}
      </SubmitButton>
    </ActionForm>
  );
}

export function PickForm({ action, month }: { action: Action; month: string }) {
  return (
    <ActionForm action={action} confirmMessage={`Make this ${month}'s project of the month?`} className="space-y-2">
      <Field label={`Organizers: make this ${month}'s project of the month`}>
        <input name="note" maxLength={500} placeholder="Why (shown with it, optional)" className={inputClass} />
      </Field>
      <SubmitButton size="sm" variant="secondary">
        Pick it
      </SubmitButton>
    </ActionForm>
  );
}
