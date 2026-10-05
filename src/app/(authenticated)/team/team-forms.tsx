"use client";

import { ActionForm, SubmitButton, TemporaryPassword, inputClass } from "@/components/form";
import { roleLabel } from "@/lib/labels";
import type { Role } from "@/lib/permissions";
import { changeRoleAction, createMemberAction, resetPasswordAction, setActiveAction, setCapacityAction } from "./actions";

const roles = Object.entries(roleLabel) as [Role, string][];

function RoleSelect({ defaultValue }: { defaultValue: Role }) {
  return (
    <select name="role" defaultValue={defaultValue} className={inputClass}>
      {roles.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function CreateMemberForm() {
  return (
    <section>
      <ActionForm
        action={createMemberAction}
        resetOnSuccess
        className="grid gap-3 sm:grid-cols-4 sm:items-end"
        renderResult={(state) =>
          state.ok && (
            <div className="sm:col-span-4">
              <TemporaryPassword email={state.data.email} password={state.data.temporaryPassword} />
            </div>
          )
        }
      >
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Name</span>
          <input name="name" required className={inputClass} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Email</span>
          <input name="email" type="email" required className={inputClass} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Role</span>
          <RoleSelect defaultValue="TEAM_MEMBER" />
        </label>
        <SubmitButton pendingText="Adding…">Add member</SubmitButton>
      </ActionForm>
    </section>
  );
}

type Member = { id: string; email: string; role: Role; active: boolean; weeklyCapacityHours: number };

export function MemberActions({ member }: { member: Member }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">Manage</summary>
      <div className="ml-auto mt-3 w-72 space-y-4 rounded-lg border border-line bg-surface p-3 text-left shadow-sm">
        <ActionForm action={changeRoleAction} resetOnSuccess className="space-y-2">
          <input type="hidden" name="userId" value={member.id} />
          <RoleSelect defaultValue={member.role} />
          <input name="reason" required placeholder="Reason for the change" className={inputClass} />
          <SubmitButton size="sm">Change role</SubmitButton>
        </ActionForm>

        <ActionForm action={setCapacityAction} className="space-y-2">
          <input type="hidden" name="userId" value={member.id} />
          <label className="block space-y-1 text-xs">
            <span className="font-medium">Weekly capacity (hours for project work)</span>
            <input name="hours" type="number" min={0} max={80} required defaultValue={member.weeklyCapacityHours} className={inputClass} />
          </label>
          <SubmitButton size="sm" variant="secondary">Save capacity</SubmitButton>
        </ActionForm>

        <ActionForm action={setActiveAction} resetOnSuccess className="space-y-2">
          <input type="hidden" name="userId" value={member.id} />
          <input type="hidden" name="active" value={String(!member.active)} />
          <input
            name="reason"
            required
            placeholder={member.active ? "Why deactivate?" : "Why reactivate?"}
            className={inputClass}
          />
          <SubmitButton size="sm" variant={member.active ? "danger" : "secondary"}>{member.active ? "Deactivate" : "Reactivate"}</SubmitButton>
        </ActionForm>

        <ActionForm
          action={resetPasswordAction}
          confirmMessage={`Reset the password for ${member.email}? They will be signed out.`}
          className="space-y-2"
          renderResult={(state) =>
            state.ok && <TemporaryPassword email={state.data.email} password={state.data.temporaryPassword} />
          }
        >
          <input type="hidden" name="userId" value={member.id} />
          <input type="hidden" name="email" value={member.email} />
          <SubmitButton size="sm" variant="secondary" pendingText="Resetting…">Reset password</SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}
