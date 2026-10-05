import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { comments, projects, tasks, users } from "@/lib/db/schema";
import { type Actor, assertCan } from "@/lib/permissions";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { notify } from "@/modules/notifications";
import { type Mentionable, findMentions } from "./mentions";

// Project discussion (roadmap Stage 2: comments and mentions). Anyone who can see the project
// can read and write; comments are never edited or deleted. Mentioned people, the project owner
// and the task's assignee are notified in-app.

export const commentInput = z.object({
  body: z.string().trim().min(1, "Write a comment").max(5000, "At most 5,000 characters"),
  taskId: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.uuid().nullable())
    .nullish(),
});

/** Everyone involved in the project: owner, current team and task assignees. */
async function projectPeople(tx: Tx, projectId: string): Promise<{ ownerId: string; people: Mentionable[] }> {
  const [project] = await tx.select({ ownerId: projects.projectOwnerId }).from(projects).where(eq(projects.id, projectId));
  if (!project) throw new ServiceError("Project not found.");
  const team = await tx.execute<{ member_id: string }>(sql`SELECT member_id FROM app_project_team(${projectId})`);
  const assignees = await tx.selectDistinct({ id: tasks.assignedTo }).from(tasks).where(eq(tasks.projectId, projectId));
  const ids = [
    ...new Set([project.ownerId, ...team.rows.map((r) => r.member_id), ...assignees.map((a) => a.id).filter((id): id is string => !!id)]),
  ];
  const people = await tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  return { ownerId: project.ownerId, people };
}

export async function addComment(actor: Actor, projectId: string, raw: z.input<typeof commentInput>) {
  const input = commentInput.parse(raw);
  return withActor(actor, async (tx) => {
    // Row-level security hides projects the actor cannot see; that is the membership check.
    const { ownerId, people } = await projectPeople(tx, projectId);
    assertCan(actor, "comment.create", { isProjectMember: true });
    let task: { title: string; assignedTo: string | null } | undefined;
    if (input.taskId) {
      [task] = await tx.select({ title: tasks.title, assignedTo: tasks.assignedTo }).from(tasks).where(eq(tasks.id, input.taskId));
      if (!task) throw new ServiceError("That task is not part of this project.");
    }
    const mentioned = findMentions(input.body, people).filter((id) => id !== actor.id);
    const [comment] = await tx
      .insert(comments)
      .values({ projectId, taskId: input.taskId ?? null, authorId: actor.id, body: input.body, mentionedIds: mentioned })
      .returning()
      .catch(rethrowDbGuard);

    const [project] = await tx.select({ code: projects.code }).from(projects).where(eq(projects.id, projectId));
    const [author] = await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.id));
    const about = task ? ` on "${task.title}"` : "";
    const preview = input.body.length > 160 ? `${input.body.slice(0, 160)}…` : input.body;
    const recipients = new Map<string, string>();
    for (const id of mentioned) recipients.set(id, `${author.name} mentioned you in ${project.code}${about}`);
    for (const id of [ownerId, task?.assignedTo]) {
      if (id && id !== actor.id && !recipients.has(id)) recipients.set(id, `${author.name} commented in ${project.code}${about}`);
    }
    for (const [recipientId, title] of recipients) {
      await notify(tx, actor, { recipientId, type: "comment.created", title, message: preview, entityType: "project", entityId: projectId });
    }
    return comment;
  });
}

export async function listComments(actor: Actor, projectId: string) {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({ comment: comments, authorName: users.name, taskTitle: tasks.title })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .leftJoin(tasks, eq(tasks.id, comments.taskId))
      .where(eq(comments.projectId, projectId))
      .orderBy(asc(comments.createdAt));
    const ids = [...new Set(rows.flatMap((r) => r.comment.mentionedIds))];
    const names = new Map(
      ids.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : [],
    );
    return rows.map((r) => ({
      ...r.comment,
      authorName: r.authorName,
      taskTitle: r.taskTitle,
      mentionedNames: r.comment.mentionedIds.map((id) => names.get(id)).filter((n): n is string => !!n),
    }));
  });
}
