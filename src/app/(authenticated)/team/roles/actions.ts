"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, runAction } from "@/lib/action-result";
import type { PermissionKey } from "@/lib/permissions";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import {
  addJobTitle,
  applyTeamType,
  createRole,
  renameJobTitle,
  setJobTitleArchived,
  setRoleArchived,
  updateRole,
} from "@/modules/roles";
import { type TeamType, teamTypeLabel } from "@/modules/roles/presets";

// Phase 28: the company's roles and job titles.

function done() {
  revalidatePath("/team/roles");
  revalidatePath("/team");
  revalidatePath("/dashboard");
}

export async function createRoleAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createRole(
      actor,
      { name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""), copyFrom: String(form.get("copyFrom") ?? "") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Role created. Open it below to switch permissions on or off.");
  if (result.ok) done();
  return result;
}

export async function updateRoleAction(roleId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateRole(
      actor,
      roleId,
      {
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        permissions: form.getAll("permissions").map(String) as PermissionKey[],
      },
      await getRequestMeta(),
    );
    return undefined;
  }, "Role saved. People with it get the change on their next page.");
  if (result.ok) done();
  return result;
}

export async function archiveRoleAction(roleId: string, archived: boolean): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await setRoleArchived(actor, roleId, archived, await getRequestMeta());
    return undefined;
  }, archived ? "Role archived." : "Role restored.");
  if (result.ok) done();
  return result;
}

export async function addJobTitleAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await addJobTitle(actor, String(form.get("name") ?? ""), await getRequestMeta());
    return undefined;
  }, "Job title added.");
  if (result.ok) done();
  return result;
}

export async function renameJobTitleAction(titleId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await renameJobTitle(actor, titleId, String(form.get("name") ?? ""), await getRequestMeta());
    return undefined;
  }, "Saved.");
  if (result.ok) done();
  return result;
}

export async function archiveJobTitleAction(titleId: string, archived: boolean): Promise<ActionResult> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await setJobTitleArchived(actor, titleId, archived, await getRequestMeta());
    return undefined;
  }, archived ? "Job title archived." : "Job title restored.");
  if (result.ok) done();
  return result;
}

export async function teamTypeAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireUser();
  const teamType = String(form.get("teamType") ?? "") as TeamType;
  const result = await runAction(async () => {
    const added = await applyTeamType(actor, teamType, await getRequestMeta());
    return added;
  });
  if (!result.ok) return result;
  done();
  const { titles, roles } = result.data;
  return {
    ok: true,
    data: undefined,
    message:
      titles + roles === 0
        ? `You already have everything suggested for "${teamTypeLabel[teamType]}".`
        : `Added ${titles} job title${titles === 1 ? "" : "s"} and ${roles} role${roles === 1 ? "" : "s"}. Change or archive any of them below.`,
  };
}
