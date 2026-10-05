import { asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { milestones, projectTemplates, tasks } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { addDays } from "@/modules/notifications/deadlines";
import { assertEditable, lockProject } from "@/modules/projects";
import { type Outline, formatOutline, outlineCounts, parseOutline } from "./outline";

// Project and task templates (roadmap 2.7). Applying a template adds its milestones and
// unassigned tasks to a project; due dates count from the project's start date (or today).

export const templateInput = z.object({
  name: z.string().trim().min(3, "Name the template (at least 3 characters)").max(100),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null)
    .nullish(),
  outline: z.string().max(20_000),
});

function parseOrThrow(text: string): Outline {
  const { outline, errors } = parseOutline(text);
  if (errors.length) throw new ServiceError(errors.slice(0, 5).join(" "));
  return outline;
}

export async function listTemplates(actor: Actor, { includeInactive = false } = {}) {
  assertCan(actor, "template.manage");
  return withActor(actor, async (tx) => {
    const rows = await tx.select().from(projectTemplates).orderBy(asc(projectTemplates.name));
    return rows
      .filter((t) => includeInactive || t.active)
      .map((t) => ({ ...t, counts: outlineCounts(parseOutline(t.outline).outline) }));
  });
}

export async function getTemplate(actor: Actor, id: string) {
  assertCan(actor, "template.manage");
  return withActor(actor, async (tx) => (await tx.select().from(projectTemplates).where(eq(projectTemplates.id, id)))[0] ?? null);
}

export async function createTemplate(actor: Actor, raw: z.input<typeof templateInput>, request?: RequestMeta) {
  assertCan(actor, "template.manage");
  const input = templateInput.parse(raw);
  const outline = parseOrThrow(input.outline);
  return withActor(actor, async (tx) => {
    const [existing] = await tx.select({ id: projectTemplates.id }).from(projectTemplates).where(eq(projectTemplates.name, input.name));
    if (existing) throw new ServiceError("A template with that name already exists.");
    const [template] = await tx
      .insert(projectTemplates)
      .values({ name: input.name, description: input.description ?? null, outline: formatOutline(outline), createdBy: actor.id })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "template",
      entityId: template.id,
      action: "template.created",
      after: { name: template.name, ...outlineCounts(outline) },
      request,
    });
    return template;
  });
}

export async function updateTemplate(actor: Actor, id: string, raw: z.input<typeof templateInput> & { active?: boolean }, request?: RequestMeta) {
  assertCan(actor, "template.manage");
  const input = templateInput.parse(raw);
  const outline = parseOrThrow(input.outline);
  return withActor(actor, async (tx) => {
    const [current] = await tx.select().from(projectTemplates).where(eq(projectTemplates.id, id)).for("update");
    if (!current) throw new ServiceError("Template not found.");
    const [clash] = await tx.select({ id: projectTemplates.id }).from(projectTemplates).where(eq(projectTemplates.name, input.name));
    if (clash && clash.id !== id) throw new ServiceError("A template with that name already exists.");
    const active = raw.active ?? current.active;
    const [updated] = await tx
      .update(projectTemplates)
      .set({ name: input.name, description: input.description ?? null, outline: formatOutline(outline), active })
      .where(eq(projectTemplates.id, id))
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "template",
      entityId: id,
      action: "template.updated",
      before: { name: current.name, active: current.active, ...outlineCounts(parseOutline(current.outline).outline) },
      after: { name: updated.name, active: updated.active, ...outlineCounts(outline) },
      request,
    });
    return updated;
  });
}

/** Adds the template's milestones and unassigned tasks to an editable project. */
export async function applyTemplate(actor: Actor, projectId: string, templateId: string, request?: RequestMeta) {
  assertCan(actor, "template.manage");
  assertCan(actor, "project.edit");
  return withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    assertEditable(project);
    const [template] = await tx.select().from(projectTemplates).where(eq(projectTemplates.id, templateId));
    if (!template?.active) throw new ServiceError("Template not found.");
    const outline = parseOrThrow(template.outline);
    const base = project.startDate ?? todayInOperatingZone();
    const due = (offset: number | null) => (offset === null ? null : addDays(base, offset));
    const taskValues = (t: Outline["looseTasks"][number], milestoneId: string | null) => ({
      projectId,
      milestoneId,
      title: t.title,
      required: t.required,
      dueDate: due(t.dueOffsetDays),
      estimateHours: t.estimateHours,
    });

    const [row] = await tx.select({ last: max(milestones.sequence) }).from(milestones).where(eq(milestones.projectId, projectId));
    let sequence = row?.last ?? 0;
    let taskCount = 0;
    if (outline.looseTasks.length) {
      await tx.insert(tasks).values(outline.looseTasks.map((t) => taskValues(t, null)));
      taskCount += outline.looseTasks.length;
    }
    for (const m of outline.milestones) {
      const offsets = m.tasks.map((t) => t.dueOffsetDays).filter((d): d is number => d !== null);
      const [milestone] = await tx
        .insert(milestones)
        .values({ projectId, title: m.title, sequence: ++sequence, dueDate: offsets.length ? due(Math.max(...offsets)) : null })
        .returning();
      if (m.tasks.length) await tx.insert(tasks).values(m.tasks.map((t) => taskValues(t, milestone.id)));
      taskCount += m.tasks.length;
    }
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.template_applied",
      after: { template: template.name, milestones: outline.milestones.length, tasks: taskCount, datesFrom: base },
      request,
    });
    return { milestones: outline.milestones.length, tasks: taskCount };
  });
}

/** Turns a project's milestones and tasks into a new template (waived tasks are left out). */
export async function saveProjectAsTemplate(
  actor: Actor,
  projectId: string,
  raw: { name: string; description?: string },
  request?: RequestMeta,
) {
  assertCan(actor, "template.manage");
  const outlineText = await withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    const ms = await tx.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(asc(milestones.sequence));
    const ts = (await tx.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.createdAt))).filter(
      (t) => t.status !== "WAIVED",
    );
    const base = project.startDate ?? project.createdAt.toISOString().slice(0, 10);
    const offset = (d: string | null) =>
      d === null ? null : Math.max(0, Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86_400_000));
    const toTask = (t: (typeof ts)[number]) => ({ title: t.title, dueOffsetDays: offset(t.dueDate), estimateHours: t.estimateHours, required: t.required });
    return formatOutline({
      looseTasks: ts.filter((t) => !t.milestoneId).map(toTask),
      milestones: ms.map((m) => ({ title: m.title, tasks: ts.filter((t) => t.milestoneId === m.id).map(toTask) })),
    });
  });
  return createTemplate(actor, { name: raw.name, description: raw.description, outline: outlineText }, request);
}
