import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, companyRoles, jobTitles, memberships, organizations, payoutLedgerEntries } from "@/lib/db/schema";
import { type Actor, PermissionError } from "@/lib/permissions";
import { approveProject, requestApproval } from "@/modules/approvals";
import { createOrganization, setSelfApproval } from "@/modules/orgs";
import { recordPayment } from "@/modules/payments";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import {
  addJobTitle,
  applyTeamType,
  createRole,
  listJobTitles,
  listRoles,
  setJobTitleArchived,
  setMemberJobTitle,
  setRoleArchived,
  updateRole,
} from "@/modules/roles";
import { changeRole, createMember } from "@/modules/team";
import { createCompany, createUser, db, expectDbError } from "./fixtures";

const today = new Date().toISOString().slice(0, 10);

/** A new company (two people for money: on) with an Admin, a PM and a member. */
async function company() {
  const { org, owner } = await createCompany();
  const pm = await createUser("PROJECT_MANAGER", { orgId: org.id });
  const member = await createUser("TEAM_MEMBER", { orgId: org.id });
  return { org, owner, pm, member };
}

/** An in-progress project in that company, split 50/50 between `a` and `b`, waiting for approval. */
async function pendingProject(owner: Actor, pm: Actor, a: Actor, b: Actor) {
  const project = await createProject(pm, {
    name: `Roles ${crypto.randomUUID().slice(0, 6)}`,
    clientType: "EXTERNAL",
    clientName: "Acme Ltd",
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    agodShare: "0",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Backend developer", split: "50" });
  await addAssignment(pm, project.id, { memberId: b.id, roleOnProject: "Frontend developer", split: "50" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  return project;
}

const versionOf = async (actor: Actor, projectId: string) =>
  withActor(actor, async (tx) => (await tx.execute<{ version: number }>(`select version from projects where id = '${projectId}'`)).rows[0].version);

describe("two people for money", () => {
  it("new companies have it on; nobody approves a project that pays them", async () => {
    const { org, owner, pm, member } = await company();
    const [row] = await db.select({ allow: organizations.allowSelfApproval }).from(organizations).where(eq(organizations.id, org.id));
    expect(row.allow).toBe(false);

    const project = await pendingProject(owner, pm, pm, member);
    await requestApproval(member, project.id);
    await expect(approveProject(pm, project.id, { expectedVersion: await versionOf(pm, project.id) })).rejects.toThrow(/You are paid on this project/);
    // Someone not paid on it may approve.
    const result = await approveProject(owner, project.id, { expectedVersion: await versionOf(owner, project.id) });
    expect(result.ledgerEntries).toBe(2);
  });

  it("nobody approves what they asked to have approved", async () => {
    const { owner, pm, member } = await company();
    const other = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
    const project = await pendingProject(owner, pm, member, other);
    await requestApproval(pm, project.id);
    await expect(approveProject(pm, project.id, { expectedVersion: await versionOf(pm, project.id) })).rejects.toThrow(/You asked for this approval/);
    await approveProject(owner, project.id, { expectedVersion: await versionOf(owner, project.id) });
  });

  it("nobody records a payment on their own payout, and the database refuses it on its own", async () => {
    const { owner, pm, member } = await company();
    const project = await pendingProject(owner, pm, owner, member);
    await requestApproval(member, project.id);
    await approveProject(pm, project.id, { expectedVersion: await versionOf(pm, project.id) });
    const [own] = await withActor(owner, (tx) => tx.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.memberId, owner.id)));
    await expect(recordPayment(owner, own.id, { amount: "100", method: "MOBILE_MONEY", paidOn: today })).rejects.toThrow(/your own payout/);
    await expectDbError(
      withActor(owner, (tx) =>
        tx.execute(`insert into payment_transactions (ledger_entry_id, amount_minor, currency, method, paid_at, recorded_by)
                    values ('${own.id}', 100, 'GHS', 'MOBILE_MONEY', now(), '${owner.id}')`),
      ),
      /your own payout/,
    );
    // The database also refuses a payout approved by its own payee.
    await expectDbError(
      withActor(owner, (tx) =>
        tx.execute(`insert into payout_ledger_entries (project_id, snapshot_line_id, member_id, amount_owed_minor, approved_by, approved_at)
                    select project_id, snapshot_line_id, '${owner.id}', 1, '${owner.id}', now() from payout_ledger_entries where id = '${own.id}'`),
      ),
      /someone else must approve/,
    );
  });

  it("a one-manager company can allow it; the change is audited with its reason", async () => {
    const { owner, pm, member } = await company();
    await expect(setSelfApproval(pm, { allow: true, reason: "Just the two of us" })).rejects.toThrow(PermissionError);
    await setSelfApproval(owner, { allow: true, reason: "Only one manager for now" });
    const project = await pendingProject(owner, pm, pm, member);
    await requestApproval(pm, project.id);
    await approveProject(pm, project.id, { expectedVersion: await versionOf(pm, project.id) });
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, owner.orgId), eq(auditEvents.action, "company.self_approval_changed")));
    expect(event.reason).toBe("Only one manager for now");
    expect(event.afterJson).toEqual({ allowSelfApproval: true });
  });
});

describe("company-made roles", () => {
  it("a Finance role pays the team but can't create projects; the database keeps its base role", async () => {
    const { owner, pm, member } = await company();
    const financeId = await createRole(owner, {
      name: "Finance",
      copyFrom: "ADMIN",
      permissions: ["payouts.view", "payouts.pay", "team.view"],
    });
    const person = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
    await changeRole(owner, { userId: person.id, role: financeId, reason: "Runs payroll" });
    const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, person.id), eq(memberships.organizationId, owner.orgId)));
    expect(m.role).toBe("ADMIN");
    expect(m.companyRoleId).toBe(financeId);

    const finance: Actor = { id: person.id, role: "ADMIN", orgId: owner.orgId, permissions: ["payouts.view", "payouts.pay", "team.view"] };
    await expect(createProject(finance, { name: "Nope", clientType: "INTERNAL", totalValue: "1", splitMode: "PERCENTAGE", projectOwnerId: finance.id })).rejects.toThrow(
      PermissionError,
    );
    const project = await pendingProject(owner, pm, member, owner);
    await requestApproval(member, project.id);
    await approveProject(pm, project.id, { expectedVersion: await versionOf(pm, project.id) });
    const [entry] = await withActor(owner, (tx) => tx.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.memberId, member.id)));
    const { balance } = await recordPayment(finance, entry.id, { amount: "100", method: "MOBILE_MONEY", paidOn: today });
    expect(balance.paidMinor).toBe(10_000);
  });

  it("nobody hands out access they don't have", async () => {
    const { owner } = await company();
    const hrId = await createRole(owner, { name: "People", copyFrom: "ADMIN", permissions: ["team.view", "team.manage"] });
    const hrUser = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
    await changeRole(owner, { userId: hrUser.id, role: hrId, reason: "Handles people" });
    const hr: Actor = { id: hrUser.id, role: "ADMIN", orgId: owner.orgId, permissions: ["team.view", "team.manage"] };

    await expect(createMember(hr, { name: "New Admin", email: `${crypto.randomUUID()}@agod.test`, role: "ADMIN" })).rejects.toThrow(/access you don't have/);
    await expect(createRole(hr, { name: "Payer", copyFrom: "ADMIN", permissions: ["payouts.pay"] })).rejects.toThrow(/Pay the team/);
    // ... nor demote someone with more access than they have.
    const pm = await createUser("PROJECT_MANAGER", { orgId: owner.orgId });
    await expect(changeRole(hr, { userId: pm.id, role: "TEAM_MEMBER", reason: "Try" })).rejects.toThrow(/access you don't have/);
    // People with no more access than them are fine.
    const { member } = await createMember(hr, { name: "New Member", email: `${crypto.randomUUID()}@agod.test`, role: "TEAM_MEMBER" });
    expect(member.role).toBe("TEAM_MEMBER");
  });

  it("a role can only narrow its base; switching groups on and off is audited", async () => {
    const { owner } = await company();
    const id = await createRole(owner, { name: "Lead", copyFrom: "PROJECT_MANAGER", permissions: ["projects.manage", "payouts.pay"] });
    const roles = await listRoles(owner);
    const lead = roles.find((r) => r.ref === id)!;
    expect(lead.baseRole).toBe("PROJECT_MANAGER");
    expect(lead.permissions).toEqual(["projects.manage"]); // "Pay the team" is above a Project Manager
    await updateRole(owner, id, { name: "Team Lead", permissions: ["projects.manage", "team.view"] });
    const [row] = await db.select().from(companyRoles).where(eq(companyRoles.id, id));
    expect(row.name).toBe("Team Lead");
    expect(row.permissions).toEqual(["projects.manage", "team.view"]);
    const [event] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, "role.updated")));
    expect(event.beforeJson).toMatchObject({ permissions: ["projects.manage"] });
    await expect(createRole(owner, { name: "team lead", copyFrom: "ADMIN" })).rejects.toThrow(/already/);
    await expect(createRole(owner, { name: "Admin", copyFrom: "ADMIN" })).rejects.toThrow(/built-in/);
  });

  it("the database keeps one Admin with full access and refuses archiving a role people hold", async () => {
    const { owner } = await company();
    const id = await createRole(owner, { name: "Limited admin", copyFrom: "ADMIN", permissions: ["team.manage", "team.view"] });
    await expectDbError(
      withActor(owner, (tx) => tx.update(memberships).set({ companyRoleId: id }).where(eq(memberships.userId, owner.id))),
      /at least one active Admin with full access/,
    );
    const other = await createUser("TEAM_MEMBER", { orgId: owner.orgId });
    await changeRole(owner, { userId: other.id, role: id, reason: "Test" });
    await expect(setRoleArchived(owner, id, true)).rejects.toThrow(/People still have this role/);
    await changeRole(owner, { userId: other.id, role: "TEAM_MEMBER", reason: "Test" });
    await setRoleArchived(owner, id, true);
    await expect(changeRole(owner, { userId: other.id, role: id, reason: "Again" })).rejects.toThrow(/archived/);
  });

  it("roles stay inside their company", async () => {
    const a = await company();
    const b = await company();
    const id = await createRole(a.owner, { name: "Finance", copyFrom: "ADMIN" });
    expect((await listRoles(b.owner)).some((r) => r.ref === id)).toBe(false);
    await expect(changeRole(b.owner, { userId: b.member.id, role: id, reason: "Cross" })).rejects.toThrow(/doesn't exist in this company/);
  });
});

describe("job titles and team type", () => {
  it("a software team gets suggested titles and roles once; titles are per company and grant nothing", async () => {
    const { owner, pm, member } = await company();
    await expect(applyTeamType(pm, "SOFTWARE")).rejects.toThrow(PermissionError);
    expect(await applyTeamType(owner, "SOFTWARE")).toEqual({ titles: 9, roles: 2 });
    expect(await applyTeamType(owner, "FINTECH")).toEqual({ titles: 4, roles: 1 });
    expect(await applyTeamType(owner, "FINTECH")).toEqual({ titles: 0, roles: 0 });
    const titles = await listJobTitles(owner);
    expect(titles.map((t) => t.name)).toContain("Backend developer");
    expect((await listRoles(owner)).map((r) => r.name)).toEqual(expect.arrayContaining(["Finance", "Team Lead", "Compliance"]));

    const backend = titles.find((t) => t.name === "Backend developer")!;
    await setMemberJobTitle(owner, member.id, backend.id);
    expect((await listJobTitles(owner)).find((t) => t.id === backend.id)?.people).toBe(1);
    await expect(addJobTitle(owner, "backend DEVELOPER")).rejects.toThrow(/already/);
    await setJobTitleArchived(owner, backend.id, true);
    await expect(setMemberJobTitle(owner, pm.id, backend.id)).rejects.toThrow(/archived/);
    const [row] = await db.select().from(jobTitles).where(eq(jobTitles.id, backend.id));
    expect(row.organizationId).toBe(owner.orgId);
  });

  it("a company created with a team type starts with its titles and roles", async () => {
    const ownerId = crypto.randomUUID();
    const { users } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: ownerId, name: "Fin Owner", email: `${ownerId}@agod.test` });
    const org = await createOrganization({ name: `Fintech ${ownerId.slice(0, 6)}`, ownerId, teamType: "FINTECH" });
    expect(org.teamType).toBe("FINTECH");
    const owner: Actor = { id: ownerId, role: "ADMIN", orgId: org.id };
    expect((await listJobTitles(owner)).map((t) => t.name)).toContain("Compliance officer");
    expect((await listRoles(owner)).filter((r) => !r.builtIn).map((r) => r.name).sort()).toEqual(["Compliance", "Finance", "Team Lead"]);
  });
});
