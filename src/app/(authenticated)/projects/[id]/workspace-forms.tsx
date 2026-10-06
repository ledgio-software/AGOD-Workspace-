"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";
import { costCategoryLabel, healthLabel, milestoneStatusLabel, projectCategoryLabel, projectStatusLabel } from "@/lib/labels";
import type { Health, ProjectStatus, TaskStatus } from "@/modules/projects/rules";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
type Option = { id: string; name: string };

export function StatusControls({ action, allowed }: { action: Action; allowed: ProjectStatus[] }) {
  const [to, setTo] = useState<ProjectStatus | "">("");
  if (allowed.length === 0) return null;
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Move project to">
        <select name="to" required value={to} onChange={(e) => setTo(e.target.value as ProjectStatus)} className={inputClass}>
          <option value="" disabled>
            Choose…
          </option>
          {allowed.map((s) => (
            <option key={s} value={s}>
              {projectStatusLabel[s]}
            </option>
          ))}
        </select>
      </Field>
      {to === "CANCELLED" && (
        <Field label="Reason for cancelling">
          <input name="reason" required className={inputClass} />
        </Field>
      )}
      <SubmitButton variant={to === "CANCELLED" ? "danger" : "primary"}>Update status</SubmitButton>
    </ActionForm>
  );
}

export function HealthOverrideForm({ action, current }: { action: Action; current: Health | null }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted">
        {current ? "Change or clear the health override" : "Override health"}
      </summary>
      <ActionForm action={action} resetOnSuccess className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Health">
          <select name="health" defaultValue={current ?? "AT_RISK"} className={inputClass}>
            {(Object.keys(healthLabel) as Health[]).map((h) => (
              <option key={h} value={h}>
                {healthLabel[h]}
              </option>
            ))}
            {current && <option value="">Clear override (use calculated)</option>}
          </select>
        </Field>
        <Field label="Reason">
          <input name="reason" required minLength={3} className={`${inputClass} w-full sm:w-72`} />
        </Field>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
    </details>
  );
}

export function AddAssignmentForm({
  action,
  members,
  splitMode,
  titles,
}: {
  action: Action;
  members: (Option & { jobTitle?: string | null })[];
  splitMode: "PERCENTAGE" | "FIXED_AMOUNT";
  /** Phase 28: the company's job titles; the role on the project is picked from them. */
  titles: string[];
}) {
  const [role, setRole] = useState("");
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-5 sm:items-end">
      <Field label="Member">
        <select
          name="memberId"
          required
          defaultValue=""
          onChange={(e) => {
            const title = members.find((m) => m.id === e.target.value)?.jobTitle;
            if (title && titles.includes(title)) setRole(title);
          }}
          className={inputClass}
        >
          <option value="" disabled>
            Choose…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      {titles.length > 0 ? (
        <Field label="Role on project">
          <select name="roleOnProject" required value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
            <option value="" disabled>
              Choose…
            </option>
            {titles.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Role on project" hint="Set up job titles under Team › Roles & job titles to pick from a list.">
          <input name="roleOnProject" required placeholder="e.g. Backend developer" className={inputClass} />
        </Field>
      )}
      <Field label={splitMode === "PERCENTAGE" ? "Share (%)" : "Amount (GHS)"}>
        <input name="split" required inputMode="decimal" placeholder={splitMode === "PERCENTAGE" ? "40" : "2500.00"} className={inputClass} />
      </Field>
      <Field label="Rationale (optional)">
        <input name="rationale" className={inputClass} />
      </Field>
      <SubmitButton>Add to team</SubmitButton>
    </ActionForm>
  );
}

export function AssignmentRowActions({
  updateAction,
  removeAction,
  defaults,
  splitMode,
}: {
  updateAction: Action;
  removeAction: Action;
  defaults: { roleOnProject: string; split: string; rationale: string };
  splitMode: "PERCENTAGE" | "FIXED_AMOUNT";
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">Edit</summary>
      <div className="ml-auto mt-2 w-64 space-y-4 text-left">
        <ActionForm action={updateAction} className="space-y-2">
          <input name="roleOnProject" required defaultValue={defaults.roleOnProject} className={inputClass} />
          <input
            name="split"
            required
            inputMode="decimal"
            defaultValue={defaults.split}
            aria-label={splitMode === "PERCENTAGE" ? "Share (%)" : "Amount (GHS)"}
            className={inputClass}
          />
          <input name="rationale" defaultValue={defaults.rationale} placeholder="Rationale" className={inputClass} />
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
        <ActionForm action={removeAction} className="space-y-2">
          <input name="reason" required placeholder="Why remove from the team?" className={inputClass} />
          <SubmitButton variant="danger">Remove</SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}

export function MilestoneForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Field label="Milestone">
        <input name="title" required className={inputClass} />
      </Field>
      <Field label="Due (optional)">
        <input name="dueDate" type="date" className={inputClass} />
      </Field>
      <Field label="Description (optional)">
        <input name="description" className={inputClass} />
      </Field>
      <SubmitButton>Add milestone</SubmitButton>
    </ActionForm>
  );
}

export function MilestoneStatusForm({ action, status }: { action: Action; status: keyof typeof milestoneStatusLabel }) {
  return (
    <ActionForm action={action} className="flex items-center gap-2">
      <select name="status" defaultValue={status} className={`${inputClass} w-36`}>
        {Object.entries(milestoneStatusLabel).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <SubmitButton variant="secondary">Set</SubmitButton>
    </ActionForm>
  );
}

type TaskDefaults = {
  title?: string;
  description?: string | null;
  milestoneId?: string | null;
  assignedTo?: string | null;
  required?: boolean;
  dueDate?: string | null;
  estimateHours?: number | null;
};

export function TaskForm({
  action,
  team,
  milestones,
  defaults = {},
  submitLabel,
  reset = false,
}: {
  action: Action;
  team: Option[];
  milestones: { id: string; title: string }[];
  defaults?: TaskDefaults;
  submitLabel: string;
  reset?: boolean;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={reset} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      <Field label="Task">
        <input name="title" required defaultValue={defaults.title} className={inputClass} />
      </Field>
      <Field label="Assigned to">
        <select name="assignedTo" defaultValue={defaults.assignedTo ?? ""} className={inputClass}>
          <option value="">Unassigned</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Milestone">
        <select name="milestoneId" defaultValue={defaults.milestoneId ?? ""} className={inputClass}>
          <option value="">None</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Due (optional)">
        <input name="dueDate" type="date" defaultValue={defaults.dueDate ?? ""} className={inputClass} />
      </Field>
      <Field label="Estimate in hours (optional)">
        <input name="estimateHours" type="number" min={1} max={999} step={1} defaultValue={defaults.estimateHours ?? ""} className={inputClass} />
      </Field>
      <Field label="Description (optional)">
        <input name="description" defaultValue={defaults.description ?? ""} className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input name="required" type="checkbox" defaultChecked={defaults.required ?? true} />
        Required for approval
      </label>
      <div className="sm:col-span-3">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function TaskProgressForm({ action, status, today }: { action: Action; status: TaskStatus; today: string }) {
  const [next, setNext] = useState<TaskStatus>(status === "WAIVED" ? "IN_PROGRESS" : status);
  return (
    <ActionForm action={action} className="space-y-2">
      <select
        name="status"
        value={next}
        onChange={(e) => setNext(e.target.value as TaskStatus)}
        aria-label="Task status"
        className={inputClass}
      >
        <option value="NOT_STARTED">Not started</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="BLOCKED">Blocked</option>
        <option value="IN_REVIEW">In review</option>
        <option value="READY_FOR_QA">Ready for QA</option>
        <option value="DONE">Done</option>
      </select>
      {next === "DONE" && (
        <>
          <textarea name="completionNote" required rows={2} placeholder="What was completed?" className={inputClass} />
          <Field label="Completed on">
            <input name="completedOn" type="date" required max={today} defaultValue={today} className={inputClass} />
          </Field>
          <input name="evidenceUrl" type="url" placeholder="Evidence link (optional), e.g. a PR" className={inputClass} />
        </>
      )}
      {next === "BLOCKED" && (
        <>
          <input name="blockedReason" required placeholder="What is blocking it?" className={inputClass} />
          <input name="blockedNeeds" required placeholder="What is needed to continue?" className={inputClass} />
        </>
      )}
      <SubmitButton>Save progress</SubmitButton>
    </ActionForm>
  );
}

export function WaiveForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="space-y-2">
      <input name="reason" required placeholder="Why is this task no longer needed?" className={inputClass} />
      <SubmitButton variant="secondary">Waive task</SubmitButton>
    </ActionForm>
  );
}

export function CommentForm({ action, tasks }: { action: Action; tasks: { id: string; title: string }[] }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-2">
      <Field label="Add to the discussion" hint="Mention someone on the project with @Full Name or @emailname to notify them.">
        <textarea name="body" required maxLength={5000} rows={3} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="About a task (optional)">
          <select name="taskId" defaultValue="" className={inputClass}>
            <option value="">The whole project</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>
        <SubmitButton>Post comment</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RepoForm({ action, current }: { action: Action; current: string | null }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      <Field label="GitHub repository" hint="owner/name. Pull requests and issues mentioning a task key link to tasks automatically.">
        <input name="githubRepo" defaultValue={current ?? ""} placeholder="acme-co/payroll" className={`${inputClass} w-full sm:w-72`} />
      </Field>
      <SubmitButton variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}

export function LinkGithubForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <input name="url" type="url" required placeholder="Paste a GitHub issue, PR, commit or branch link" className={`${inputClass} w-full sm:w-80`} />
      <SubmitButton variant="secondary" size="sm">
        Link
      </SubmitButton>
    </ActionForm>
  );
}

export function SmallButtonForm({ action, label, confirmMessage }: { action: Action; label: string; confirmMessage?: string }) {
  return (
    <ActionForm action={action} confirmMessage={confirmMessage} className="inline-block">
      <SubmitButton variant="secondary" size="sm">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function ProjectFinanceForm({ action, category, costBudget }: { action: Action; category: keyof typeof projectCategoryLabel; costBudget: string }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Project type">
        <select name="category" defaultValue={category} className={inputClass}>
          {Object.entries(projectCategoryLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Budget for other costs (GHS)">
        <input name="costBudget" inputMode="decimal" defaultValue={costBudget} className={inputClass} />
      </Field>
      <SubmitButton variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}

export function CostForm({ action, today }: { action: Action; today: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-2 sm:grid-cols-5 sm:items-end">
      <Field label="Category">
        <select name="category" defaultValue="SOFTWARE" className={inputClass}>
          {Object.entries(costCategoryLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Description">
        <input name="description" required minLength={3} className={inputClass} />
      </Field>
      <Field label="Vendor (optional)">
        <input name="vendor" className={inputClass} />
      </Field>
      <Field label="Amount (GHS)">
        <input name="amount" required inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="Date">
        <input name="incurredOn" type="date" required max={today} defaultValue={today} className={inputClass} />
      </Field>
      <div className="sm:col-span-5">
        <SubmitButton variant="secondary">Record cost</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function VoidCostForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-center gap-2">
      <input name="reason" required minLength={3} placeholder="Why is this cost wrong?" className={`${inputClass} w-full text-xs sm:w-64`} />
      <SubmitButton variant="secondary" size="sm">Void</SubmitButton>
    </ActionForm>
  );
}

export function MeetingForm({ action, today }: { action: Action; today: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-2 sm:items-end">
      <Field label="Title">
        <input name="title" required minLength={2} maxLength={200} placeholder="Weekly check-in" className={inputClass} />
      </Field>
      <Field label="Date">
        <input name="date" type="date" required min={today} defaultValue={today} className={inputClass} />
      </Field>
      <Field label="Start time">
        <input name="time" type="time" required defaultValue="10:00" className={inputClass} />
      </Field>
      <Field label="Length">
        <select name="durationMinutes" defaultValue="30" className={inputClass}>
          {[15, 30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Agenda (optional)">
          <textarea name="agenda" rows={2} maxLength={2000} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingText="Scheduling…">Schedule with Google Meet</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CancelMeetingForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} confirmMessage="Cancel this meeting? Google emails everyone invited.">
      <SubmitButton size="sm" variant="secondary" pendingText="Cancelling…">
        Cancel
      </SubmitButton>
    </ActionForm>
  );
}
