import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notifications, tasks } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import { changeProjectStatus, createProject, getProjectWorkspace } from "@/modules/projects";
import { addAssignment, createMilestone } from "@/modules/projects/team";
import { createTask, updateTaskDetails, updateTaskProgress, waiveTask } from "@/modules/tasks";
import { getMyWork } from "@/modules/work";
import { createUser, db } from "./fixtures";

async function activeProject() {
  const pm = await createUser("PROJECT_MANAGER");
  const member = await createUser("TEAM_MEMBER");
  const colleague = await createUser("TEAM_MEMBER");
  const project = await createProject(pm, {
    name: `Tasks ${crypto.randomUUID().slice(0, 6)}`,
    clientType: "INTERNAL",
    totalValue: "5000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Backend", split: "60" });
  await addAssignment(pm, project.id, { memberId: colleague.id, roleOnProject: "Frontend", split: "40" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  return { pm, member, colleague, project };
}

const today = new Date().toISOString().slice(0, 10);

describe("tasks", () => {
  it("assignees must be on the project team; assignment notifies them", async () => {
    const { pm, member, project } = await activeProject();
    const outsider = await createUser("TEAM_MEMBER");
    await expect(createTask(pm, project.id, { title: "Nope", assignedTo: outsider.id })).rejects.toThrow(/project team/);

    const task = await createTask(pm, project.id, { title: "Build API", assignedTo: member.id });
    const [note] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, member.id), eq(notifications.type, "task.assigned")));
    expect(note.message).toContain("Build API");
    expect(task.status).toBe("NOT_STARTED");
  });

  it("Done requires a completion note and a past/today date", async () => {
    const { pm, member, project } = await activeProject();
    const task = await createTask(pm, project.id, { title: "Build API", assignedTo: member.id });
    // @ts-expect-error missing completion note
    await expect(updateTaskProgress(member, task.id, { status: "DONE", completedOn: today })).rejects.toThrow();
    await expect(
      updateTaskProgress(member, task.id, { status: "DONE", completionNote: "Shipped", completedOn: "2999-01-01" }),
    ).rejects.toThrow(/future/);
    await updateTaskProgress(member, task.id, {
      status: "DONE",
      completionNote: "Endpoints merged",
      completedOn: today,
      evidenceUrl: "https://github.com/ledgio-software/AGOD-Workspace-/pull/1",
    });
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.status).toBe("DONE");
    expect(row.completedBy).toBe(member.id);
    const [ownerNote] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, pm.id), eq(notifications.type, "task.done")));
    expect(ownerNote).toBeDefined();
  });

  it("Blocked requires the reason and what is needed; the project shows as blocked", async () => {
    const { pm, member, project } = await activeProject();
    const task = await createTask(pm, project.id, { title: "Deploy", assignedTo: member.id });
    // @ts-expect-error missing blockedNeeds
    await expect(updateTaskProgress(member, task.id, { status: "BLOCKED", blockedReason: "No access" })).rejects.toThrow();
    await updateTaskProgress(member, task.id, { status: "BLOCKED", blockedReason: "No server access", blockedNeeds: "SSH key from Admin" });
    expect((await getProjectWorkspace(pm, project.id))?.health).toBe("BLOCKED");
    // Moving on clears the blocker fields.
    await updateTaskProgress(member, task.id, { status: "IN_PROGRESS" });
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.blockedReason).toBeNull();
  });

  it("members cannot update someone else's task, change details or waive", async () => {
    const { pm, member, colleague, project } = await activeProject();
    const task = await createTask(pm, project.id, { title: "UI", assignedTo: colleague.id });
    await expect(updateTaskProgress(member, task.id, { status: "IN_PROGRESS" })).rejects.toThrow(PermissionError);
    await expect(updateTaskDetails(colleague, task.id, { title: "Renamed" })).rejects.toThrow(PermissionError);
    await expect(waiveTask(colleague, task.id, "Not needed")).rejects.toThrow(PermissionError);
  });

  it("no progress on draft projects", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, {
      name: "Draft",
      clientType: "INTERNAL",
      totalValue: "1",
      splitMode: "PERCENTAGE",
      projectOwnerId: pm.id,
    });
    await addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Dev", split: "100" });
    const task = await createTask(pm, project.id, { title: "Early", assignedTo: member.id });
    await expect(updateTaskProgress(member, task.id, { status: "IN_PROGRESS" })).rejects.toThrow(/state/);
  });

  it("waiving needs a reason and removes the task from progress", async () => {
    const { pm, member, project } = await activeProject();
    const done = await createTask(pm, project.id, { title: "Task A", assignedTo: member.id });
    const skipped = await createTask(pm, project.id, { title: "Task B", assignedTo: member.id });
    await updateTaskProgress(member, done.id, { status: "DONE", completionNote: "Done", completedOn: today });
    await expect(waiveTask(pm, skipped.id, "")).rejects.toThrow();
    await waiveTask(pm, skipped.id, "Client dropped this feature");
    expect((await getProjectWorkspace(pm, project.id))?.progress).toEqual({ done: 1, total: 1, percent: 100 });
    await expect(updateTaskProgress(member, skipped.id, { status: "IN_PROGRESS" })).rejects.toThrow(/waived/);
  });
});

describe("My Work", () => {
  it("matches the project workspace and summarises the member's work", async () => {
    const { pm, member, colleague, project } = await activeProject();
    const milestone = await createMilestone(pm, project.id, { title: "MVP" });
    const t1 = await createTask(pm, project.id, { title: "One", assignedTo: member.id, milestoneId: milestone.id });
    const t2 = await createTask(pm, project.id, { title: "Two", assignedTo: member.id, dueDate: "2020-01-01" });
    const t3 = await createTask(pm, project.id, { title: "Three", assignedTo: colleague.id });
    await updateTaskProgress(member, t1.id, { status: "DONE", completionNote: "Done", completedOn: today });
    await updateTaskProgress(colleague, t3.id, { status: "DONE", completionNote: "Done", completedOn: today });

    const work = await getMyWork(member);
    const workspace = await getProjectWorkspace(pm, project.id);
    const entry = work.currentProjects.find((p) => p.id === project.id);

    expect(entry?.projectProgress).toEqual(workspace?.progress);
    expect(entry?.projectProgress.percent).toBe(67);
    expect(entry?.myProgress).toEqual({ done: 1, total: 2, percent: 50 });
    expect(entry?.myRoles).toEqual(["Backend"]);
    expect(work.summary).toMatchObject({ assigned: 2, completed: 1, overdue: 1, blocked: 0 });
    expect(work.completedTasks.map((t) => t.id)).toEqual([t1.id]);
    expect(work.tasks.find((t) => t.id === t2.id)?.overdue).toBe(true);
    expect(work.unreadNotifications.length).toBeGreaterThan(0);
    expect(work.payouts.owedMinor).toBe(0);
  });
});
