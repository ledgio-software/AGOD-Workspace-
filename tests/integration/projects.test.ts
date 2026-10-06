import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, projectAssignments, projects } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import { ServiceError } from "@/modules/errors";
import {
  type ProjectInput,
  changeProjectStatus,
  createProject,
  getProjectWorkspace,
  listProjects,
  updateProject,
} from "@/modules/projects";
import { addAssignment, removeAssignment, updateAssignment } from "@/modules/projects/team";
import { createTask } from "@/modules/tasks";
import { createUser, db } from "./fixtures";

const input = (ownerId: string, overrides: Partial<ProjectInput> = {}): ProjectInput => ({
  name: `Payroll module ${crypto.randomUUID().slice(0, 6)}`,
  clientType: "INTERNAL",
  totalValue: "10,000.00",
  splitMode: "PERCENTAGE",
  projectOwnerId: ownerId,
  ...overrides,
});

describe("creating projects", () => {
  it("team members cannot create projects", async () => {
    const member = await createUser("TEAM_MEMBER");
    await expect(createProject(member, input(member.id))).rejects.toThrow(PermissionError);
  });

  it("assigns sequential AGOD-<year>-<nnn> codes, stores money in pesewas and audits", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const first = await createProject(pm, input(pm.id));
    const second = await createProject(pm, input(pm.id));
    expect(first.code).toMatch(/^AGOD-\d{4}-\d{3}$/);
    expect(Number(second.code.slice(-3))).toBe(Number(first.code.slice(-3)) + 1);
    expect(first.totalValueMinor).toBe(1_000_000);
    expect(first.status).toBe("DRAFT");
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, first.id));
    expect(event.action).toBe("project.created");
  });

  it("validates input", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    await expect(createProject(pm, input(pm.id, { totalValue: "12.345" }))).rejects.toThrow(/GHS/);
    await expect(
      createProject(pm, input(pm.id, { startDate: "2026-10-10", targetDate: "2026-10-01" })),
    ).rejects.toThrow(/target date/);
    await expect(createProject(pm, input(pm.id, { clientType: "EXTERNAL" }))).rejects.toThrow(/customer for an external project/);
  });

  it("rejects an inactive project owner", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const gone = await createUser("TEAM_MEMBER", { active: false });
    await expect(createProject(pm, input(gone.id))).rejects.toThrow(ServiceError);
  });
});

describe("editing projects", () => {
  it("rejects a stale edit (optimistic concurrency)", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const project = await createProject(pm, input(pm.id));
    await updateProject(pm, project.id, { ...input(pm.id, { name: "First edit" }), version: project.version });
    await expect(
      updateProject(pm, project.id, { ...input(pm.id, { name: "Stale edit" }), version: project.version }),
    ).rejects.toThrow(/changed this project meanwhile/);
  });

  it("follows the status rules and requires a reason to cancel", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const project = await createProject(pm, input(pm.id));
    await changeProjectStatus(pm, project.id, { to: "PLANNING" });
    await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
    await expect(changeProjectStatus(pm, project.id, { to: "DRAFT" })).rejects.toThrow(/cannot move/);
    await expect(changeProjectStatus(pm, project.id, { to: "CANCELLED" })).rejects.toThrow(/reason/);
    // @ts-expect-error COMPLETED is only reachable through the approval flow
    await expect(changeProjectStatus(pm, project.id, { to: "COMPLETED" })).rejects.toThrow();
  });

  it("locks details, team and tasks once approval is requested", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, input(pm.id));
    await db.update(projects).set({ status: "PENDING_APPROVAL" }).where(eq(projects.id, project.id));

    await expect(updateProject(pm, project.id, { ...input(pm.id), version: project.version })).rejects.toThrow(/locked/);
    await expect(
      addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Developer", split: "100" }),
    ).rejects.toThrow(/locked/);
    await expect(createTask(pm, project.id, { title: "Late task" })).rejects.toThrow(/locked/);
  });

  it("does not switch split mode while splits exist", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, input(pm.id));
    await addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Developer", split: "100" });
    await expect(
      updateProject(pm, project.id, { ...input(pm.id, { splitMode: "FIXED_AMOUNT" }), version: project.version }),
    ).rejects.toThrow(/switching/);
  });
});

describe("team and compensation", () => {
  it("builds a valid percentage plan with a deterministic preview", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const a = await createUser("TEAM_MEMBER");
    const b = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, input(pm.id, { totalValue: "100.01" }));
    await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Backend", split: "50" });
    await addAssignment(pm, project.id, { memberId: b.id, roleOnProject: "Frontend", split: "50" });

    const workspace = await getProjectWorkspace(pm, project.id);
    expect(workspace?.compensation?.valid).toBe(true);
    expect(workspace?.compensation?.lines.map((l) => l.amountMinor)).toEqual([5_001, 5_000]);
    expect(workspace?.compensation?.allocatedMinor).toBe(10_001);
  });

  it("flags an invalid plan in the preview", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const a = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, input(pm.id));
    await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Backend", split: "60" });
    const workspace = await getProjectWorkspace(pm, project.id);
    expect(workspace?.compensation?.valid).toBe(false);
    expect(workspace?.compensation?.errors[0]).toMatch(/100%/);
  });

  it("rejects inactive members, duplicate roles and bad splits", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const a = await createUser("TEAM_MEMBER");
    const gone = await createUser("TEAM_MEMBER", { active: false });
    const project = await createProject(pm, input(pm.id));
    await expect(
      addAssignment(pm, project.id, { memberId: gone.id, roleOnProject: "Dev", split: "10" }),
    ).rejects.toThrow(/Inactive/);
    await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "10" });
    await expect(
      addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "10" }),
    ).rejects.toThrow(/already has that role/);
    await expect(
      addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "QA", split: "101" }),
    ).rejects.toThrow(/percentage/);
  });

  it("removing a member keeps the history (deactivated, audited with reason)", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const a = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, input(pm.id));
    const assignment = await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "100" });
    await updateAssignment(pm, assignment.id, { roleOnProject: "Lead dev", split: "100" });
    await removeAssignment(pm, assignment.id, "Moved to another project");
    const [row] = await db.select().from(projectAssignments).where(eq(projectAssignments.id, assignment.id));
    expect(row.active).toBe(false);
    const actions = (await db.select().from(auditEvents).where(eq(auditEvents.entityId, assignment.id))).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["assignment.added", "assignment.updated", "assignment.removed"]));
  });

  it("team members cannot configure compensation", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, input(pm.id));
    await expect(
      addAssignment(member, project.id, { memberId: member.id, roleOnProject: "Dev", split: "100" }),
    ).rejects.toThrow(PermissionError);
  });
});

describe("visibility", () => {
  it("members see only their projects, and only their own split", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const a = await createUser("TEAM_MEMBER");
    const b = await createUser("TEAM_MEMBER");
    const mine = await createProject(pm, input(pm.id));
    const other = await createProject(pm, input(pm.id));
    await addAssignment(pm, mine.id, { memberId: a.id, roleOnProject: "Backend", split: "70" });
    await addAssignment(pm, mine.id, { memberId: b.id, roleOnProject: "Frontend", split: "30" });

    const visible = (await listProjects(a)).map((p) => p.id);
    expect(visible).toContain(mine.id);
    expect(visible).not.toContain(other.id);
    expect(await getProjectWorkspace(a, other.id)).toBeNull();

    const workspace = await getProjectWorkspace(a, mine.id);
    expect(workspace?.compensation).toBeNull();
    expect(workspace?.team.map((t) => t.memberId).sort()).toEqual([a.id, b.id].sort());
    expect(workspace?.team.find((t) => t.memberId === a.id)?.split?.basisPoints).toBe(7_000);
    expect(workspace?.team.find((t) => t.memberId === b.id)?.split).toBeNull();

    // And the database itself refuses to hand a teammate's split to a member.
    const rows = await withActor(a, (tx) =>
      tx.select().from(projectAssignments).where(eq(projectAssignments.projectId, mine.id)),
    );
    expect(rows.map((r) => r.memberId)).toEqual([a.id]);
  });

  it("searches by name and code", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const unique = `Zebra-${crypto.randomUUID().slice(0, 6)}`;
    const project = await createProject(pm, input(pm.id, { name: unique }));
    expect((await listProjects(pm, { q: unique })).map((p) => p.id)).toEqual([project.id]);
    expect((await listProjects(pm, { q: project.code })).map((p) => p.id)).toContain(project.id);
    expect(await listProjects(pm, { q: "%" })).toBeDefined();
    await db.execute(sql`select 1`);
  });
});
