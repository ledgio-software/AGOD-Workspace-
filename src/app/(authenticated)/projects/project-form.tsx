"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, inputClass } from "@/components/form";
import type { ActionResult } from "@/lib/action-result";

type Member = { id: string; name: string };

/** The AGOD share pre-filled for new percentage-split projects; the PM can change it per project. */
export const DEFAULT_AGOD_SHARE_PERCENT = "30";
type Defaults = {
  name?: string;
  description?: string | null;
  clientType?: "INTERNAL" | "EXTERNAL";
  clientName?: string | null;
  totalValue?: string;
  splitMode?: "PERCENTAGE" | "FIXED_AMOUNT";
  agodShare?: string;
  projectOwnerId?: string;
  startDate?: string | null;
  targetDate?: string | null;
  version?: number;
};

export function ProjectForm({
  action,
  members,
  defaults = {},
  submitLabel,
  splitModeLocked = false,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  members: Member[];
  defaults?: Defaults;
  submitLabel: string;
  splitModeLocked?: boolean;
}) {
  const [clientType, setClientType] = useState(defaults.clientType ?? "INTERNAL");
  const [splitMode, setSplitMode] = useState(defaults.splitMode ?? "PERCENTAGE");

  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      {defaults.version !== undefined && <input type="hidden" name="version" value={defaults.version} />}
      <div className="sm:col-span-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Basics</h3>
      </div>
      <div className="sm:col-span-2">
        <Field label="Project name">
          <input name="name" required defaultValue={defaults.name} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Description (optional)">
          <textarea name="description" rows={3} defaultValue={defaults.description ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2 border-t border-line pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Client and money</h3>
      </div>
      <Field label="Client type">
        <select
          name="clientType"
          value={clientType}
          onChange={(e) => setClientType(e.target.value as "INTERNAL" | "EXTERNAL")}
          className={inputClass}
        >
          <option value="INTERNAL">Internal</option>
          <option value="EXTERNAL">External</option>
        </select>
      </Field>
      <Field label="Client name" hint={clientType === "INTERNAL" ? "Not needed for internal projects. Choose External to enter a client." : undefined}>
        <input
          name="clientName"
          disabled={clientType === "INTERNAL"}
          required={clientType === "EXTERNAL"}
          defaultValue={defaults.clientName ?? ""}
          className={`${inputClass} disabled:opacity-50`}
        />
      </Field>
      <Field label="Project value (GHS)" hint="e.g. 12500.00. Stored exactly, in pesewas.">
        <input name="totalValue" required inputMode="decimal" defaultValue={defaults.totalValue} className={inputClass} />
      </Field>
      <Field
        label="Compensation split"
        hint={splitModeLocked ? "Remove all team splits to switch modes." : "One mode per project (decision 3)."}
      >
        <select
          name="splitMode"
          value={splitMode}
          onChange={(e) => setSplitMode(e.target.value as "PERCENTAGE" | "FIXED_AMOUNT")}
          className={inputClass}
        >
          <option value="PERCENTAGE">Percentages (AGOD share + team = 100%)</option>
          <option value="FIXED_AMOUNT">Fixed amounts (AGOD keeps the rest)</option>
        </select>
      </Field>
      {splitMode === "PERCENTAGE" ? (
        <Field label="AGOD share (%)" hint="What the company keeps. Team percentages must total the rest.">
          <input
            name="agodShare"
            inputMode="decimal"
            defaultValue={defaults.agodShare ?? DEFAULT_AGOD_SHARE_PERCENT}
            className={inputClass}
          />
        </Field>
      ) : (
        <p className="self-end text-sm text-muted">AGOD keeps whatever the fixed amounts don&apos;t use.</p>
      )}
      <div className="sm:col-span-2 border-t border-line pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Owner and dates</h3>
      </div>
      <Field label="Project owner">
        <select name="projectOwnerId" required defaultValue={defaults.projectOwnerId ?? ""} className={inputClass}>
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
      <div />
      <Field label="Start date (optional)">
        <input name="startDate" type="date" defaultValue={defaults.startDate ?? ""} className={inputClass} />
      </Field>
      <Field label="Target date (optional)">
        <input name="targetDate" type="date" defaultValue={defaults.targetDate ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
