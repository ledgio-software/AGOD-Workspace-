"use client";

import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export type SessionDefaults = {
  title: string;
  description: string;
  level: string;
  topics: string[];
  date: string;
  time: string;
  durationMinutes: number;
  callUrl: string;
  capacity: number | null;
};

const DURATIONS = [30, 45, 60, 90, 120, 180];

export function SessionForm({ action, defaults, today, submitLabel }: { action: Action; defaults: SessionDefaults; today: string; submitLabel: string }) {
  return (
    <ActionForm action={action} className="space-y-5">
      <Field label="Title" hint="e.g. “Build your first app with AI” or “Debug AI-generated code”.">
        <input name="title" required minLength={3} maxLength={120} defaultValue={defaults.title} className={inputClass} />
      </Field>
      <Field label="What people will learn" hint="What you'll build or show, what to bring, and who it's for.">
        <textarea name="description" required minLength={10} maxLength={3000} rows={5} defaultValue={defaults.description} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Level">
          <select name="level" defaultValue={defaults.level} className={inputClass}>
            <option value="ALL">Everyone</option>
            <option value="BEGINNER">Beginners</option>
            <option value="INTERMEDIATE">Some experience</option>
          </select>
        </Field>
        <Field label="Topics (optional)" hint="Separated by commas: e.g. Prompting, Next.js, Security.">
          <input name="topics" maxLength={300} defaultValue={defaults.topics.join(", ")} className={inputClass} />
        </Field>
        <Field label="Date">
          <input name="date" type="date" required min={today} defaultValue={defaults.date} className={inputClass} />
        </Field>
        <Field label="Start time (Accra)">
          <input name="time" type="time" required defaultValue={defaults.time} className={inputClass} />
        </Field>
        <Field label="Length">
          <select name="durationMinutes" defaultValue={String(defaults.durationMinutes)} className={inputClass}>
            {[...new Set([...DURATIONS, defaults.durationMinutes])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Seats (optional)" hint="Leave empty for no limit.">
          <input name="capacity" type="number" min={2} max={1000} defaultValue={defaults.capacity ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field label="Call link" hint="Create it on Google Meet, Zoom or a Discord voice/stage channel. Only people who join see it.">
        <input name="callUrl" required defaultValue={defaults.callUrl} placeholder="https://meet.google.com/abc-defg-hij" className={inputClass} />
      </Field>
      <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
