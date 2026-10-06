import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  compensationSnapshotLines,
  compensationSnapshots,
  invoiceSettings,
  memberships,
  organizations,
  projectTemplates,
  payoutLedgerEntries,
  projectAssignments,
  projects,
  sessions,
  tasks,
  users,
} from "@/lib/db/schema";
import type { Actor, Role } from "@/lib/permissions";
import { createOrganization } from "@/modules/orgs";
import { STARTER_TEMPLATES } from "@/modules/orgs/starter-templates";

if (!process.env.DATABASE_URL?.match(/localhost|127\.0\.0\.1/)) {
  throw new Error("Integration tests only run against a local/CI database (DATABASE_URL on localhost).");
}

// Fixtures are written through the owner connection (no RLS), like a migration or seed would.
export { db };

/**
 * Phase 22: tests run in this company unless they make another. The test database connection
 * defaults app.org_id to it (PGOPTIONS in vitest.integration.config.ts), so rows inserted directly
 * belong to it too.
 */
export const TEST_ORG_ID = "00000000-0000-4000-8000-000000000001";

let testOrg: Promise<void> | null = null;
function ensureTestOrg() {
  testOrg ??= (async () => {
    await db
      .insert(organizations)
      .values({ id: TEST_ORG_ID, name: "Test company", slug: "test-company", projectCodePrefix: "AGOD" })
      .onConflictDoNothing();
    const [template] = await db.select({ id: projectTemplates.id }).from(projectTemplates).where(eq(projectTemplates.organizationId, TEST_ORG_ID)).limit(1);
    if (!template) await db.insert(projectTemplates).values(STARTER_TEMPLATES.map((t) => ({ ...t, organizationId: TEST_ORG_ID })));
    await db.insert(invoiceSettings).values({ organizationId: TEST_ORG_ID }).onConflictDoNothing();
  })();
  return testOrg;
}

/** Another company for isolation tests (with starter templates and invoice settings). */
export async function createCompany(name = `Company ${randomUUID().slice(0, 6)}`) {
  const ownerId = randomUUID();
  await db.insert(users).values({ id: ownerId, name: `Owner ${ownerId.slice(0, 6)}`, email: `${ownerId}@agod.test` });
  const org = await createOrganization({ name, ownerId, projectCodePrefix: "ACME" });
  return { org, owner: { id: ownerId, role: "ADMIN", orgId: org.id } satisfies Actor };
}

export async function createUser(role: Role, overrides: { active?: boolean; orgId?: string } = {}): Promise<Actor> {
  await ensureTestOrg();
  const id = randomUUID();
  const orgId = overrides.orgId ?? TEST_ORG_ID;
  await db.insert(users).values({ id, name: `${role} ${id.slice(0, 6)}`, email: `${id}@agod.test`, active: overrides.active ?? true });
  await db.insert(memberships).values({ organizationId: orgId, userId: id, role, active: overrides.active ?? true });
  return { id, role, orgId };
}

export async function createSession(userId: string) {
  await db.insert(sessions).values({
    userId,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 3600_000),
  });
}

export async function createProject(ownerId: string) {
  const [project] = await db
    .insert(projects)
    .values({
      code: `AGOD-TEST-${randomUUID().slice(0, 8)}`,
      name: "Test project",
      clientType: "INTERNAL",
      totalValueMinor: 100_000,
      projectOwnerId: ownerId,
      createdBy: ownerId,
    })
    .returning();
  return project;
}

export async function assign(projectId: string, memberId: string) {
  const [assignment] = await db
    .insert(projectAssignments)
    .values({ projectId, memberId, roleOnProject: "Developer", splitType: "PERCENTAGE", splitBasisPoints: 10_000 })
    .returning();
  return assignment;
}

export async function createTask(projectId: string, assignedTo: string) {
  const [task] = await db.insert(tasks).values({ projectId, title: "Build it", assignedTo }).returning();
  return task;
}

export async function createLedgerEntry(projectId: string, memberId: string, approverId: string) {
  const assignment = await assign(projectId, memberId);
  const [snapshot] = await db
    .insert(compensationSnapshots)
    .values({
      projectId,
      projectTotalValueMinor: 100_000,
      splitMode: "PERCENTAGE",
      calculationVersion: 1,
      createdBy: approverId,
    })
    .returning();
  const [line] = await db
    .insert(compensationSnapshotLines)
    .values({
      snapshotId: snapshot.id,
      memberId,
      roleOnProject: "Developer",
      sourceAssignmentId: assignment.id,
      splitType: "PERCENTAGE",
      splitBasisPoints: 10_000,
      amountOwedMinor: 100_000,
    })
    .returning();
  const [entry] = await db
    .insert(payoutLedgerEntries)
    .values({
      projectId,
      snapshotLineId: line.id,
      memberId,
      amountOwedMinor: 100_000,
      approvedBy: approverId,
      approvedAt: new Date(),
    })
    .returning();
  return { snapshot, line, entry };
}

/** Drizzle wraps driver errors; assert on the underlying PostgreSQL message. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!error) throw new Error(`Expected a database error matching ${pattern}, but the query succeeded`);
  const cause = (error as { cause?: { message?: string } }).cause;
  const message = cause?.message ?? (error as Error).message;
  if (!pattern.test(message)) throw new Error(`Expected ${pattern}, got: ${message}`);
}
