"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

// Phase 33: forms for the jobs board and the team finder.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export type JobDefaults = {
  hirer: string;
  title: string;
  kind: string;
  workMode: string;
  location: string;
  payMin: string;
  payMax: string;
  payUnit: string;
  description: string;
  skills: string;
  closesOn: string;
};

export function JobForm({ action, defaults, submitLabel, minDate, maxDate }: { action: Action; defaults: JobDefaults; submitLabel: string; minDate: string; maxDate: string }) {
  const [kind, setKind] = useState(defaults.kind);
  const [mode, setMode] = useState(defaults.workMode);
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title">
          <input name="title" required minLength={5} maxLength={120} defaultValue={defaults.title} placeholder="e.g. Build a MoMo checkout page" className={inputClass} />
        </Field>
        <Field label="Who is hiring" hint="Your company, project or your own name.">
          <input name="hirer" required minLength={2} maxLength={120} defaultValue={defaults.hirer} className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Type">
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
            <option value="GIG">Gig (a paid piece of work)</option>
            <option value="JOB">Job (employment)</option>
            <option value="INTERNSHIP">Internship</option>
          </select>
        </Field>
        <Field label="Where">
          <select name="workMode" value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
            <option value="REMOTE">Remote</option>
            <option value="HYBRID">Hybrid</option>
            <option value="ONSITE">On site</option>
          </select>
        </Field>
        <Field label={mode === "REMOTE" ? "City (optional)" : "City"}>
          <input name="location" maxLength={80} required={mode !== "REMOTE"} defaultValue={defaults.location} placeholder="e.g. Accra" className={inputClass} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Pay (GHS){kind === "INTERNSHIP" ? " (optional for internships)" : ""}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <input name="payMin" inputMode="decimal" required={kind !== "INTERNSHIP"} defaultValue={defaults.payMin} placeholder="From, e.g. 2500" aria-label="Pay from" className={inputClass} />
          <input name="payMax" inputMode="decimal" defaultValue={defaults.payMax} placeholder="Up to (optional)" aria-label="Pay up to" className={inputClass} />
          <select name="payUnit" defaultValue={defaults.payUnit} aria-label="Pay is" className={inputClass}>
            <option value="">{kind === "INTERNSHIP" ? "No pay stated" : "Choose…"}</option>
            <option value="PROJECT">For the whole work</option>
            <option value="MONTH">A month</option>
            <option value="HOUR">An hour</option>
          </select>
        </div>
        <p className="text-xs text-muted">Jobs and gigs always show the pay. Never ask applicants to pay anything.</p>
      </fieldset>
      <Field label="About the work" hint="What needs doing, what you'll give them, how you'll work together and when it should be done.">
        <textarea name="description" required minLength={30} maxLength={5000} rows={7} defaultValue={defaults.description} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Skills (optional)" hint="Separate with commas, e.g. React, Paystack, Figma.">
          <input name="skills" maxLength={400} defaultValue={defaults.skills} className={inputClass} />
        </Field>
        <Field label="Applications close on" hint="At most 60 days from today.">
          <input type="date" name="closesOn" required min={minDate} max={maxDate} defaultValue={defaults.closesOn} className={inputClass} />
        </Field>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export function ApplyForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      <Field label="Why you're a good fit" hint="What you've built that's like this, and when you can start.">
        <textarea name="message" required minLength={20} maxLength={2000} rows={4} className={inputClass} />
      </Field>
      <Field label="Link to your work (optional)" hint="A portfolio, GitHub or a live app. Your community profile is shared too.">
        <input name="link" maxLength={500} placeholder="https://" className={inputClass} />
      </Field>
      <p className="text-xs text-muted">Applying shares your name, email and profile with the person who posted this.</p>
      <SubmitButton pendingText="Sending…">Apply</SubmitButton>
    </ActionForm>
  );
}

export type TeamDefaults = { kind: string; title: string; description: string; roles: string; tools: string; commitment: string; reward: string };

export function TeamPostForm({ action, defaults, submitLabel }: { action: Action; defaults: TeamDefaults; submitLabel: string }) {
  const [kind, setKind] = useState(defaults.kind);
  const idea = kind === "IDEA";
  return (
    <ActionForm action={action} className="space-y-4">
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">I am…</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="IDEA" checked={idea} onChange={() => setKind("IDEA")} /> Building something and need teammates
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="JOINING" checked={!idea} onChange={() => setKind("JOINING")} /> Looking for a team to join
        </label>
      </fieldset>
      <Field label="Title">
        <input name="title" required minLength={5} maxLength={120} defaultValue={defaults.title} placeholder={idea ? "e.g. Trotro times: when the next car leaves" : "e.g. Designer looking for a fintech side project"} className={inputClass} />
      </Field>
      <Field label={idea ? "The idea" : "About you"} hint="Everyone can read this. Don't share secrets or personal data.">
        <textarea name="description" required minLength={20} maxLength={3000} rows={5} defaultValue={defaults.description} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={idea ? "Roles you need" : "Roles you can take"} hint="Separate with commas, e.g. Designer, Backend developer.">
          <input name="roles" required maxLength={400} defaultValue={defaults.roles} className={inputClass} />
        </Field>
        <Field label="Tools (optional)" hint="e.g. Lovable, Supabase, Flutter.">
          <input name="tools" maxLength={400} defaultValue={defaults.tools} className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Time needed">
          <input name="commitment" required minLength={2} maxLength={80} defaultValue={defaults.commitment} placeholder="e.g. 5 hours a week for 2 months" className={inputClass} />
        </Field>
        <Field label="Reward">
          <select name="reward" defaultValue={defaults.reward} className={inputClass}>
            <option value="LEARNING">For learning and the portfolio</option>
            <option value="SHARE">A share of what it earns</option>
            <option value="PAID">Paid</option>
          </select>
        </Field>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export function TeamRequestForm({ action, idea }: { action: Action; idea: boolean }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      <Field label={idea ? "Why you want to join" : "Why you'd like them on your team"} hint="What you can do and how much time you have.">
        <textarea name="message" required minLength={10} maxLength={1000} rows={3} className={inputClass} />
      </Field>
      <p className="text-xs text-muted">If they accept, you both see each other&apos;s email.</p>
      <SubmitButton pendingText="Sending…">{idea ? "Ask to join" : "Invite to your team"}</SubmitButton>
    </ActionForm>
  );
}
