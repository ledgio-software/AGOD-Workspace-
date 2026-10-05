import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, comments, milestones, notifications, projectTemplates, projects, tasks, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { PermissionError } from "@/lib/permissions";
import { ServiceError } from "@/modules/errors";
import { addComment, listComments } from "@/modules/comments";
import { addDays, refreshDeadlineAlerts } from "@/modules/notifications/deadlines";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { getWeeklySummary } from "@/modules/reports/weekly";
import { getWorkload } from "@/modules/reports/workload";
import { createTask, updateTaskDetails, updateTaskProgress } from "@/modules/tasks";
import { setCapacity } from "@/modules/team";
import { applyTemplate, createTemplate, listTemplates, saveProjectAsTemplate } from "@/modules/templates";
import { createUser, db, expectDbError } from "./fixtures";

const today = todayInOperatingZone();
const uniq = () => crypto.randomUUID().slice(0, 6);
const nameOf = async (id: string) => (await db.select({ name: users.name }).from(users).where(eq(users.id, id)))[0].name;

async function project({ startDate }: { startDate?: string } = {}) {
  const pm = await createUser("PROJECT_MANAGER");
  const admin = await createUser("ADMIN");
  const a = await createUser("TEAM_MEMBER");
  const b = await createUser("TEAM_MEMBER");
  const outsider = await createUser("TEAM_MEMBER");
  const p = await createProject(pm, {
    name: `Collab ${uniq()}`,
    clientType: "INTERNAL",
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
    startDate,
  });
  await addAssignment(pm, p.id, { memberId: a.id, roleOnProject: "Dev", split: "50" });
  await addAssignment(pm, p.id, { memberId: b.id, roleOnProject: "QA", split: "50" });
  await changeProjectStatus(pm, p.id, { to: "PLANNING" });
  await changeProjectStatus(pm, p.id, { to: "IN_PROGRESS" });
  return { pm, admin, a, b, outsider, project: p };
}

describe("comments and mentions", () => {
  it("notifies mentioned team members, the owner and the task assignee; ignores outsiders", async () => {
    const { pm, a, b, outsider, project: p } = await project();
    const task = await createTask(pm, p.id, { title: "API", assignedTo: b.id });
    const bName = await nameOf(b.id);
    const outsiderName = await nameOf(outsider.id);
    await addComment(a, p.id, { body: `@${bName} can you check this? cc @${outsiderName}`, taskId: task.id });

    const [comment] = await listComments(pm, p.id);
    expect(comment.mentionedIds).toEqual([b.id]);
    expect(comment.taskTitle).toBe("API");
    const types = async (id: string) =>
      (await db.select().from(notifications).where(and(eq(notifications.recipientId, id), eq(notifications.type, "comment.created")))).map((n) => n.title);
    expect(await types(b.id)).toEqual([expect.stringContaining("mentioned you")]);
    expect(await types(pm.id)).toEqual([expect.stringContaining("commented")]);
    expect(await types(outsider.id)).toEqual([]);
    expect(await types(a.id)).toEqual([]);
  });

  it("only people who can see the project can comment, and comments are append-only", async () => {
    const { pm, outsider, project: p } = await project();
    await expect(addComment(outsider, p.id, { body: "Hello" })).rejects.toThrow(ServiceError);
    await expectDbError(
      withActor(outsider, (tx) => tx.insert(comments).values({ projectId: p.id, authorId: outsider.id, body: "sneaky" })),
      /row-level security/,
    );
    const other = await project();
    const foreignTask = await createTask(other.pm, other.project.id, { title: "Elsewhere" });
    await expectDbError(
      withActor(pm, (tx) => tx.insert(comments).values({ projectId: p.id, taskId: foreignTask.id, authorId: pm.id, body: "wrong task" })),
      /not part of this project/,
    );
    const c = await addComment(pm, p.id, { body: "Kick-off on Monday" });
    await expectDbError(db.update(comments).set({ body: "edited" }).where(eq(comments.id, c.id)), /append-only/);
  });
});

describe("templates", () => {
  it("applies milestones and unassigned tasks with dates from the project start", async () => {
    const { pm, a, project: p } = await project({ startDate: "2026-11-02" });
    const t = await createTemplate(pm, { name: `Tpl ${uniq()}`, outline: "- Kick-off | +1d | 2h\n# Build\n- Pages | +10d | 16h\n- Docs | optional" });
    await expect(applyTemplate(a, p.id, t.id)).rejects.toThrow(PermissionError);
    expect(await applyTemplate(pm, p.id, t.id)).toEqual({ milestones: 1, tasks: 3 });

    const ms = await db.select().from(milestones).where(eq(milestones.projectId, p.id));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ title: "Build", dueDate: "2026-11-12" });
    const ts = await db.select().from(tasks).where(eq(tasks.projectId, p.id));
    expect(ts.map((x) => [x.title, x.dueDate, x.estimateHours, x.required, x.assignedTo]).sort()).toEqual([
      ["Docs", null, null, false, null],
      ["Kick-off", "2026-11-03", 2, true, null],
      ["Pages", "2026-11-12", 16, true, null],
    ]);
    const saved = await saveProjectAsTemplate(pm, p.id, { name: `Copy ${uniq()}` });
    expect(saved.outline).toBe("- Kick-off | +1d | 2h\n# Build\n- Pages | +10d | 16h\n- Docs | optional");
  });

  it("refuses bad outlines, duplicate names, locked projects and member access", async () => {
    const { pm, a, project: p } = await project();
    await expect(createTemplate(pm, { name: "Broken template", outline: "# Only a milestone" })).rejects.toThrow(/at least one task/);
    const name = `Dup ${uniq()}`;
    const t = await createTemplate(pm, { name, outline: "- Task" });
    await expect(createTemplate(pm, { name, outline: "- Task" })).rejects.toThrow(/already exists/);
    await db.update(projects).set({ status: "PENDING_APPROVAL" }).where(eq(projects.id, p.id));
    await expect(applyTemplate(pm, p.id, t.id)).rejects.toThrow(/locked/);
    expect(await withActor(a, (tx) => tx.select().from(projectTemplates))).toEqual([]);
    const starters = (await listTemplates(pm)).map((x) => x.name);
    expect(starters).toEqual(expect.arrayContaining(["Website", "Mobile app", "Maintenance / support"]));
  });
});

describe("estimates, capacity and workload", () => {
  it("compares estimated hours due this week with weekly capacity", async () => {
    const { pm, admin, a, project: p } = await project();
    const t1 = await createTask(pm, p.id, { title: "Due tomorrow", assignedTo: a.id, dueDate: addDays(today, 1), estimateHours: "12" });
    await createTask(pm, p.id, { title: "Overdue", assignedTo: a.id, dueDate: addDays(today, -1), estimateHours: "8" });
    await createTask(pm, p.id, { title: "Later", assignedTo: a.id, dueDate: addDays(today, 30), estimateHours: "40" });
    await expect(setCapacity(pm, { userId: a.id, hours: "20" })).rejects.toThrow(PermissionError);
    await setCapacity(admin, { userId: a.id, hours: "20" });

    const row = (await getWorkload(pm)).rows.find((r) => r.id === a.id)!;
    expect(row).toMatchObject({ open: 3, overdue: 1, dueThisWeek: 1, plannedHours: 20, openHours: 60, weeklyCapacityHours: 20, loadPercent: 100 });
    await expect(getWorkload(a)).rejects.toThrow(PermissionError);

    // Members can't change their own estimate, even directly.
    await expectDbError(withActor(a, (tx) => tx.update(tasks).set({ estimateHours: 1 }).where(eq(tasks.id, t1.id))), /Only a project manager/);
    await updateTaskDetails(pm, t1.id, { title: "Due tomorrow", assignedTo: a.id, dueDate: addDays(today, 1), estimateHours: "" });
    expect((await db.select().from(tasks).where(eq(tasks.id, t1.id)))[0].estimateHours).toBeNull();
  });
});

describe("approval reminders", () => {
  it("reminds the owner after 2 days and escalates to Admins after 7", async () => {
    const { pm, admin, project: p } = await project();
    await db.update(projects).set({ status: "PENDING_APPROVAL" }).where(eq(projects.id, p.id));
    await db.insert(auditEvents).values({
      actorId: pm.id,
      entityType: "project",
      entityId: p.id,
      projectId: p.id,
      action: "project.approval_requested",
      createdAt: new Date(Date.now() - 8 * 86_400_000),
    });
    expect(await refreshDeadlineAlerts(pm)).toBe(2);
    expect(await refreshDeadlineAlerts(pm)).toBe(0);
    const adminAlerts = async () =>
      db.select().from(notifications).where(and(eq(notifications.recipientId, admin.id), eq(notifications.type, "approval.escalated")));
    await refreshDeadlineAlerts(admin);
    expect((await adminAlerts()).filter((n) => n.entityId === p.id)).toHaveLength(1);
  });
});

describe("weekly summary", () => {
  it("shows this week's completed work, blocked and overdue tasks", async () => {
    const { pm, a, b, project: p } = await project();
    const done = await createTask(pm, p.id, { title: `Done ${uniq()}`, assignedTo: a.id });
    await updateTaskProgress(a, done.id, { status: "DONE", completionNote: "Shipped", completedOn: today });
    const blocked = await createTask(pm, p.id, { title: `Blocked ${uniq()}`, assignedTo: b.id });
    await updateTaskProgress(b, blocked.id, { status: "BLOCKED", blockedReason: "Waiting for keys", blockedNeeds: "Keys" });
    const late = await createTask(pm, p.id, { title: `Late ${uniq()}`, assignedTo: b.id, dueDate: addDays(today, -2) });

    const s = await getWeeklySummary(pm);
    expect(s.completed.map((t) => t.id)).toContain(done.id);
    expect(s.newlyBlocked.map((t) => t.taskId)).toContain(blocked.id);
    expect(s.blockedNow.map((t) => t.id)).toContain(blocked.id);
    expect(s.overdueNow.map((t) => t.id)).toContain(late.id);
    await expect(getWeeklySummary(a)).rejects.toThrow(PermissionError);
  });
});
