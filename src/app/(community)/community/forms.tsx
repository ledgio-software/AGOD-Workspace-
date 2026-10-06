"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import {
  acceptConductAction,
  createCompanyAction,
  resolveReportAction,
  setOrganizerAction,
  unhideProfileAction,
  updateProfileAction,
} from "./actions";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function AcceptConductForm() {
  return (
    <ActionForm action={acceptConductAction}>
      <SubmitButton size="sm" pendingText="Saving…">
        I agree to the code of conduct
      </SubmitButton>
    </ActionForm>
  );
}

export type ProfileDefaults = {
  handle: string;
  headline: string | null;
  bio: string | null;
  city: string | null;
  tools: string[];
  websiteUrl: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  reviewer: boolean;
  wantsMentor: boolean;
  visibility: string;
};

export function ProfileForm({ defaults, baseUrl }: { defaults: ProfileDefaults; baseUrl: string }) {
  return (
    <ActionForm action={updateProfileAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What you build" hint="One line, e.g. “Mobile money apps for small shops with Lovable and Supabase”.">
          <input name="headline" maxLength={140} defaultValue={defaults.headline ?? ""} className={inputClass} />
        </Field>
        <Field label="City">
          <input name="city" maxLength={60} defaultValue={defaults.city ?? ""} placeholder="Accra" className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Tools you use" hint="Separated by commas, up to 15: e.g. Claude, Cursor, Next.js, Flutter.">
            <input name="tools" maxLength={600} defaultValue={defaults.tools.join(", ")} className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="About you (optional)">
            <textarea name="bio" rows={4} maxLength={1500} defaultValue={defaults.bio ?? ""} className={inputClass} />
          </Field>
        </div>
        <Field label="Website (optional)">
          <input name="websiteUrl" defaultValue={defaults.websiteUrl ?? ""} placeholder="https://" className={inputClass} />
        </Field>
        <Field label="GitHub (optional)">
          <input name="githubUrl" defaultValue={defaults.githubUrl ?? ""} placeholder="https://github.com/…" className={inputClass} />
        </Field>
        <Field label="LinkedIn (optional)">
          <input name="linkedinUrl" defaultValue={defaults.linkedinUrl ?? ""} placeholder="https://linkedin.com/in/…" className={inputClass} />
        </Field>
        <Field label="X (optional)">
          <input name="xUrl" defaultValue={defaults.xUrl ?? ""} placeholder="https://x.com/…" className={inputClass} />
        </Field>
      </div>
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 font-medium">How you take part</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="reviewer" defaultChecked={defaults.reviewer} className="mt-1" />
          <span>
            <span className="font-medium">I can review work and mentor</span>
            <span className="block text-xs text-muted">You get the Reviewer badge and appear under “Reviewers” in the member list.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="wantsMentor" defaultChecked={defaults.wantsMentor} className="mt-1" />
          <span>
            <span className="font-medium">I&apos;m looking for a mentor</span>
          </span>
        </label>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Profile address" hint={`${baseUrl}/members/${defaults.handle}`}>
          <input name="handle" required minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" defaultValue={defaults.handle} className={inputClass} />
        </Field>
        <Field label="Who can see your profile">
          <select name="visibility" defaultValue={defaults.visibility} className={inputClass}>
            <option value="PUBLIC">Everyone (shows on the public member list)</option>
            <option value="MEMBERS">Signed-in members only</option>
          </select>
        </Field>
      </div>
      <p className="text-xs text-muted">Your email address is never shown on your profile.</p>
      <SubmitButton>Save profile</SubmitButton>
    </ActionForm>
  );
}

export function CreateCompanyForm() {
  return (
    <ActionForm action={createCompanyAction} className="space-y-3">
      <Field label="Company or team name">
        <input name="name" required minLength={2} maxLength={120} autoComplete="organization" className={inputClass} />
      </Field>
      <SubmitButton pendingText="Creating…">Create workspace</SubmitButton>
    </ActionForm>
  );
}

export function ReportForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      <Field label="What is wrong?" hint="Organizers see your name and this message. The member doesn't.">
        <textarea name="reason" required minLength={10} maxLength={1000} rows={3} className={inputClass} />
      </Field>
      <SubmitButton size="sm" variant="secondary" pendingText="Sending…">
        Send to the organizers
      </SubmitButton>
    </ActionForm>
  );
}

export function ResolveReportForm({ reportId }: { reportId: string }) {
  return (
    <ActionForm action={resolveReportAction.bind(null, reportId)} className="space-y-2">
      <Field label="Note (what you did and why)">
        <input name="note" required minLength={3} maxLength={500} className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="action" value="HIDE" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
          Hide the profile
        </button>
        <button type="submit" name="action" value="DISMISS" className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-surface-muted">
          Nothing wrong: dismiss
        </button>
      </div>
    </ActionForm>
  );
}

export function UnhideForm({ handle }: { handle: string }) {
  return (
    <ActionForm action={unhideProfileAction.bind(null, handle)} confirmMessage="Show this profile to everyone again?">
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        Show the profile again
      </SubmitButton>
    </ActionForm>
  );
}

export function OrganizerForm({ handle, on }: { handle: string; on: boolean }) {
  return (
    <ActionForm action={setOrganizerAction.bind(null, handle, on)} confirmMessage={on ? "Make this member an organizer? Organizers handle reports and can hide profiles." : "Remove this member's organizer role?"}>
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        {on ? "Make organizer" : "Remove organizer role"}
      </SubmitButton>
    </ActionForm>
  );
}
