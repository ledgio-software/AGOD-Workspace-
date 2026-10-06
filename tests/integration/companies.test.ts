import { randomUUID } from "node:crypto";
import { eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import * as schema from "@/lib/db/schema";
import { memberships, organizations, payoutLedgerEntries, projectMeetings, projects, tasks } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { PermissionError } from "@/lib/permissions";
import { approveProject, requestApproval } from "@/modules/approvals";
import { addComment } from "@/modules/comments";
import { createCustomer, getCustomer } from "@/modules/customers";
import { recordCost } from "@/modules/finance";
import { addInvoiceLine, createDraftInvoice, getInvoice, issueInvoice } from "@/modules/invoices";
import { addProjectLink } from "@/modules/links";
import { getOrganization, slugify, suggestPrefix, updateOrganization } from "@/modules/orgs";
import { recordPayment } from "@/modules/payments";
import { changeProjectStatus, createProject, getProjectWorkspace, listProjects } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { createService, createSubscription } from "@/modules/subscriptions";
import { createTask, updateTaskProgress } from "@/modules/tasks";
import { listTeam } from "@/modules/team";
import { createCompany, createUser, db, expectDbError } from "./fixtures";

// Phase 22: one company's data is never visible to, or changeable by, another company.

/** Every table with an organization_id column, from the schema itself (new tables are covered automatically). */
const companyTables = Object.values(schema)
  .filter((t): t is typeof projects => typeof t === "object" && t !== null && Symbol.for("drizzle:IsDrizzleTable") in t)
  .filter((t) => "organizationId" in getTableColumns(t))
  .map((t) => getTableName(t));

/** A company with data in (almost) every table, made through the normal services. */
async function companyWithData() {
  const admin = await createUser("ADMIN");
  const pm = await createUser("PROJECT_MANAGER");
  const member = await createUser("TEAM_MEMBER");
  const today = todayInOperatingZone();
  const customer = await createCustomer(pm, { name: `Isolated ${randomUUID().slice(0, 8)}`, type: "COMPANY", status: "ACTIVE", ownerId: pm.id });
  const project = await createProject(pm, {
    name: "Secret project",
    clientType: "EXTERNAL",
    customerId: customer.id,
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: member.id, roleOnProject: "Dev", split: "100" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  const task = await createTask(pm, project.id, { title: "Build", assignedTo: member.id });
  await addComment(pm, project.id, { body: "Private discussion", taskId: task.id });
  await addProjectLink(pm, { projectId: project.id, url: "https://docs.google.com/document/d/secret/edit" });
  await recordCost(pm, project.id, { category: "HOSTING", description: "Hosting", amount: "10.00", incurredOn: today });
  await updateTaskProgress(member, task.id, { status: "DONE", completionNote: "Shipped", completedOn: today });
  await requestApproval(member, project.id);
  const [{ version }] = await db.select({ version: projects.version }).from(projects).where(eq(projects.id, project.id));
  await approveProject(pm, project.id, { expectedVersion: version });
  const [entry] = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id));
  await recordPayment(admin, entry.id, { amount: "100.00", method: "MOBILE_MONEY", paidOn: today });
  const service = await createService(pm, { code: `S${randomUUID().slice(0, 6)}`, name: "Hosting", defaultCadence: "MONTHLY", defaultPrice: "50" });
  await createSubscription(pm, {
    customerId: customer.id,
    serviceId: service.id,
    startDate: "2026-01-01",
    ownerId: pm.id,
    activate: true,
    billingCadence: "MONTHLY",
    price: "50.00",
    pricingBasis: "FIXED",
    quantity: 1,
    noticePeriodDays: 30,
  });
  const invoice = await createDraftInvoice(pm, { customerId: customer.id });
  await addInvoiceLine(pm, invoice.id, { description: "Setup", quantity: 1, unitPrice: "100" });
  await db.insert(projectMeetings).values({ projectId: project.id, title: "Secret meeting", startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), createdBy: pm.id });
  return { admin, pm, member, customer, project, task, entry, invoice };
}

describe("keeping companies apart", () => {
  it("covers every company-owned table", () => {
    expect(companyTables.length).toBeGreaterThanOrEqual(33);
    expect(companyTables).toEqual(expect.arrayContaining(["projects", "tasks", "invoices", "payout_ledger_entries", "audit_events", "memberships"]));
  });

  it("another company sees none of a company's rows, in any table", async () => {
    const a = await companyWithData();
    const { owner: bAdmin } = await createCompany();

    // Through the services.
    expect(await getProjectWorkspace(bAdmin, a.project.id)).toBeNull();
    expect(await getCustomer(bAdmin, a.customer.id)).toBeNull();
    expect(await getInvoice(bAdmin, a.invoice.id)).toBeNull();
    expect((await listProjects(bAdmin)).map((p) => p.id)).not.toContain(a.project.id);
    expect((await listTeam(bAdmin)).map((m) => m.id)).toEqual([bAdmin.id]);

    // Straight in the database, table by table: nothing of company A, even for B's Admin.
    for (const table of companyTables) {
      const n = await withActor(bAdmin, async (tx) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)} where organization_id = ${a.admin.orgId}`)).rows[0].n,
      ).catch((error: { cause?: { message?: string } }) => {
        // Tables closed to the app role altogether (Google tokens) hide even more.
        if (/permission denied/.test(error.cause?.message ?? "")) return 0;
        throw error;
      });
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    // A sees its own.
    const [{ n: own }] = await withActor(a.admin, async (tx) => (await tx.execute<{ n: number }>(sql`select count(*)::int as n from tasks`)).rows);
    expect(own).toBeGreaterThan(0);
  });

  it("another company can't change, link to or claim a company's rows", async () => {
    const a = await companyWithData();
    const { owner: bAdmin } = await createCompany();
    const bProject = await createProject(bAdmin, { name: "B project", clientType: "INTERNAL", totalValue: "10", splitMode: "PERCENTAGE", projectOwnerId: bAdmin.id });

    // Updates find nothing to change.
    const changed = await withActor(bAdmin, (tx) => tx.update(projects).set({ name: "Hacked" }).where(eq(projects.id, a.project.id)).returning());
    expect(changed).toHaveLength(0);
    // Rows can't be written into another company.
    await expectDbError(
      withActor(bAdmin, (tx) => tx.insert(tasks).values({ organizationId: a.admin.orgId, projectId: a.project.id, title: "Planted" })),
      /row-level security/,
    );
    // Nor can B's rows point at A's records or people.
    await expectDbError(withActor(bAdmin, (tx) => tx.insert(tasks).values({ projectId: a.project.id, title: "Planted" })), /another company/);
    await expect(addAssignment(bAdmin, bProject.id, { memberId: a.member.id, roleOnProject: "Dev", split: "100" })).rejects.toThrow();
    await expectDbError(
      withActor(bAdmin, (tx) => tx.insert(tasks).values({ projectId: bProject.id, title: "x", assignedTo: a.member.id })),
      /not a member of this company/,
    );
    // Functions that bypass row-level security check the company too.
    await expectDbError(withActor(bAdmin, (tx) => tx.execute(sql`select app_request_approval(${a.project.id}::uuid)`)), /Project not found/);
    const team = await withActor(bAdmin, async (tx) => (await tx.execute(sql`select * from app_project_team(${a.project.id}::uuid)`)).rows);
    expect(team).toEqual([]);
    const balance = await withActor(bAdmin, async (tx) => (await tx.execute(sql`select * from ledger_balance(${a.entry.id}::uuid)`)).rows);
    expect(balance).toEqual([]);
    // Pretending to be in A's company without a membership gives no role there.
    const pretender = { ...bAdmin, orgId: a.admin.orgId };
    expect((await listProjects(pretender)).map((p) => p.id)).not.toContain(a.project.id);
    await expect(createProject(pretender, { name: "x", clientType: "INTERNAL", totalValue: "1", splitMode: "PERCENTAGE", projectOwnerId: bAdmin.id })).rejects.toThrow();
  });

  it("numbers projects and invoices per company", async () => {
    await companyWithData();
    const { owner } = await createCompany();
    const year = todayInOperatingZone().slice(0, 4);
    const first = await createProject(owner, { name: "First", clientType: "INTERNAL", totalValue: "10", splitMode: "PERCENTAGE", projectOwnerId: owner.id });
    expect(first.code).toBe(`ACME-${year}-001`);

    const customer = await createCustomer(owner, { name: "B's customer", type: "COMPANY", status: "ACTIVE", ownerId: owner.id });
    const draft = await createDraftInvoice(owner, { customerId: customer.id });
    await addInvoiceLine(owner, draft.id, { description: "Work", quantity: 1, unitPrice: "10" });
    const today = todayInOperatingZone();
    const [current] = await db.select({ version: schema.invoices.version }).from(schema.invoices).where(eq(schema.invoices.id, draft.id));
    const issued = await issueInvoice(owner, draft.id, { issueDate: today, dueDate: today, version: current.version });
    expect(issued.number).toBe(`INV-${year}-0001`);

    // Same customer name and template names are fine in different companies.
    const [sameName] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.projectTemplates).where(eq(schema.projectTemplates.name, "Website"));
    expect(sameName.n).toBeGreaterThanOrEqual(2);
  });
});

describe("company settings", () => {
  it("only Admins rename the company or change the project code prefix (new codes only)", async () => {
    const { owner } = await createCompany("Acme Digital Ltd");
    const pm = await createUser("PROJECT_MANAGER", { orgId: owner.orgId });
    await expect(updateOrganization(pm, { name: "Mine now", projectCodePrefix: "PM" })).rejects.toThrow(PermissionError);
    await expect(updateOrganization(owner, { name: "Acme", projectCodePrefix: "1BAD" })).rejects.toThrow(/letters/);

    const year = todayInOperatingZone().slice(0, 4);
    const before = await createProject(owner, { name: "Old", clientType: "INTERNAL", totalValue: "1", splitMode: "PERCENTAGE", projectOwnerId: owner.id });
    await updateOrganization(owner, { name: "Acme Digital", projectCodePrefix: "adg" });
    const org = await getOrganization(owner);
    expect(org).toMatchObject({ name: "Acme Digital", projectCodePrefix: "ADG" });
    const after = await createProject(owner, { name: "New", clientType: "INTERNAL", totalValue: "1", splitMode: "PERCENTAGE", projectOwnerId: owner.id });
    expect(before.code).toBe(`ACME-${year}-001`);
    expect(after.code).toBe(`ADG-${year}-001`);

    // The short name never changes.
    await expectDbError(withActor(owner, (tx) => tx.update(organizations).set({ slug: "taken" }).where(eq(organizations.id, owner.orgId))), /Only a company/);
    // Members of other companies can't read it.
    const outsider = await createUser("ADMIN");
    expect(await withActor(outsider, (tx) => tx.select().from(organizations).where(eq(organizations.id, owner.orgId)))).toEqual([]);
    expect(await withActor(outsider, (tx) => tx.select().from(memberships).where(eq(memberships.organizationId, owner.orgId)))).toEqual([]);
  });

  it("suggests short names and prefixes", () => {
    expect(slugify("Acme Digital Ltd.")).toBe("acme-digital-ltd");
    expect(slugify("!!!")).toBe("company");
    expect(suggestPrefix("Acme Digital Ltd")).toBe("ACME");
    expect(suggestPrefix("Ghana Vibe Coders & Developers")).toBe("GHANA");
    expect(suggestPrefix("A")).toBe("ACO");
  });
});
