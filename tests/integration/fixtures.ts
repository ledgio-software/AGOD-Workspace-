import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  compensationSnapshotLines,
  compensationSnapshots,
  payoutLedgerEntries,
  projectAssignments,
  projects,
  sessions,
  tasks,
  users,
} from "@/lib/db/schema";
import type { Actor, Role } from "@/lib/permissions";

if (!process.env.DATABASE_URL?.match(/localhost|127\.0\.0\.1/)) {
  throw new Error("Integration tests only run against a local/CI database (DATABASE_URL on localhost).");
}

// Fixtures are written through the owner connection (no RLS), like a migration or seed would.
export { db };

export async function createUser(role: Role, overrides: { active?: boolean } = {}): Promise<Actor> {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    name: `${role} ${id.slice(0, 6)}`,
    email: `${id}@agod.test`,
    role,
    active: overrides.active ?? true,
  });
  return { id, role };
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
