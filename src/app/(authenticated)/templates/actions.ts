"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { applyTemplate, createTemplate, saveProjectAsTemplate, updateTemplate } from "@/modules/templates";

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function createTemplateAction(_prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  let id = "";
  const result = await runAction(async () => {
    id = (await createTemplate(actor, { name: text(form, "name"), description: text(form, "description"), outline: text(form, "outline") }, await getRequestMeta())).id;
    return undefined;
  });
  if (!result.ok) return result;
  revalidatePath("/templates");
  redirect(`/templates/${id}`);
}

export async function updateTemplateAction(id: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateTemplate(
      actor,
      id,
      { name: text(form, "name"), description: text(form, "description"), outline: text(form, "outline"), active: form.get("active") === "on" },
      await getRequestMeta(),
    );
    return undefined;
  }, "Template saved.");
  if (result.ok) revalidatePath("/templates");
  return result;
}

export async function applyTemplateAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  let added = { milestones: 0, tasks: 0 };
  const result = await runAction(async () => {
    added = await applyTemplate(actor, projectId, text(form, "templateId"), await getRequestMeta());
    return undefined;
  });
  if (!result.ok) return result;
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, data: undefined, message: `Added ${added.milestones} milestone(s) and ${added.tasks} task(s). Assign the tasks to team members.` };
}

export async function saveAsTemplateAction(projectId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await saveProjectAsTemplate(actor, projectId, { name: text(form, "name"), description: text(form, "description") }, await getRequestMeta());
    return undefined;
  }, "Saved as a template. Find it under Templates.");
  if (result.ok) revalidatePath("/templates");
  return result;
}
