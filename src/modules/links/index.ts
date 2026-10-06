import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "@/lib/db/actor";
import { projectLinks, tasks, users } from "@/lib/db/schema";
import { checkLink } from "@/lib/links";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";

// Phase 21: links to Google Drive files (or other https pages) on a project or a task. Same rules
// as attachments: managers add to any project or task, members to tasks assigned to them; the
// person who added a link or a manager removes it. Everyone who can see the project sees them.

const title = z.string().trim().max(200, "Keep the title under 200 characters");

export async function addProjectLink(
  actor: Actor,
  input: { projectId: string; taskId?: string | null; url: string; title?: string | null },
  request?: RequestMeta,
) {
  const link = checkLink(input.url);
  if ("error" in link) throw new ServiceError(link.error);
  const name = title.parse(input.title ?? "") || link.suggestedTitle;
  return withActor(actor, async (tx) => {
    let projectId = input.projectId;
    if (input.taskId) {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.taskId));
      if (!task) throw new ServiceError("Task not found.");
      assertCan(actor, "task.update", { isTaskAssignee: task.assignedTo === actor.id });
      projectId = task.projectId;
    } else {
      assertCan(actor, "project.edit");
    }
    const [row] = await tx
      .insert(projectLinks)
      .values({ projectId, taskId: input.taskId ?? null, url: link.url, title: name, provider: link.provider, addedBy: actor.id })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project_link",
      entityId: row.id,
      projectId,
      action: "link.added",
      after: { title: row.title, url: row.url, taskId: row.taskId },
      request,
    });
    return row;
  });
}

export async function removeProjectLink(actor: Actor, id: string, request?: RequestMeta) {
  await withActor(actor, async (tx) => {
    const [row] = await tx.select().from(projectLinks).where(eq(projectLinks.id, id));
    if (!row || row.removedAt) throw new ServiceError("Link not found.");
    if (row.addedBy !== actor.id) assertCan(actor, "project.edit");
    await tx
      .update(projectLinks)
      .set({ removedAt: new Date(), removedBy: actor.id })
      .where(eq(projectLinks.id, id))
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project_link",
      entityId: id,
      projectId: row.projectId,
      action: "link.removed",
      before: { title: row.title, url: row.url },
      request,
    });
  });
}

export type LinkView = { id: string; url: string; title: string; provider: string; addedBy: string; addedByName: string; createdAt: Date };

/** Current links of a project: project-level ones, and per task. */
export async function listProjectLinks(actor: Actor, projectId: string) {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: projectLinks.id,
        url: projectLinks.url,
        title: projectLinks.title,
        provider: projectLinks.provider,
        addedBy: projectLinks.addedBy,
        addedByName: users.name,
        createdAt: projectLinks.createdAt,
        taskId: projectLinks.taskId,
      })
      .from(projectLinks)
      .innerJoin(users, eq(users.id, projectLinks.addedBy))
      .where(and(eq(projectLinks.projectId, projectId), isNull(projectLinks.removedAt)))
      .orderBy(asc(projectLinks.createdAt));
    const byTask = new Map<string, LinkView[]>();
    for (const r of rows) if (r.taskId) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
    return { project: rows.filter((r) => !r.taskId), byTask };
  });
}
