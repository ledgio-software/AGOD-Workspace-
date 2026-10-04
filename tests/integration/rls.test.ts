import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import {
  auditEvents,
  compensationSnapshotLines,
  paymentTransactions,
  payoutLedgerEntries,
  projects,
  tasks,
} from "@/lib/db/schema";
import { recordAudit } from "@/modules/audit";
import { assign, createLedgerEntry, createProject, createTask, createUser, db, expectDbError } from "./fixtures";

// These tests bypass the service layer on purpose: they prove the database alone refuses
// what the permission service would refuse.

describe("row-level security: projects and tasks", () => {
  it("team members cannot create projects", async () => {
    const member = await createUser("TEAM_MEMBER");
    await expectDbError(
      withActor(member, (tx) =>
        tx.insert(projects).values({
          code: `X-${randomUUID()}`,
          name: "Sneaky",
          clientType: "INTERNAL",
          totalValueMinor: 1,
          projectOwnerId: member.id,
          createdBy: member.id,
        }),
      ),
      /row-level security/,
    );
  });

  it("team members see only projects they belong to; managers see all", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const mine = await createProject(pm.id);
    const other = await createProject(pm.id);
    await assign(mine.id, member.id);

    const visible = await withActor(member, (tx) => tx.select({ id: projects.id }).from(projects));
    const ids = visible.map((p) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(other.id);

    const pmVisible = await withActor(pm, (tx) => tx.select({ id: projects.id }).from(projects));
    expect(pmVisible.map((p) => p.id)).toEqual(expect.arrayContaining([mine.id, other.id]));
  });

  it("nobody can delete a project through the app role", async () => {
    const admin = await createUser("ADMIN");
    const project = await createProject(admin.id);
    await expectDbError(
      withActor(admin, (tx) => tx.delete(projects).where(eq(projects.id, project.id))),
      /permission denied/,
    );
  });

  it("members update progress on their own task but not its details, and cannot waive it", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const project = await createProject(pm.id);
    const task = await createTask(project.id, member.id);

    await withActor(member, (tx) =>
      tx.update(tasks).set({ status: "IN_PROGRESS" }).where(eq(tasks.id, task.id)),
    );
    const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(updated.status).toBe("IN_PROGRESS");

    await expectDbError(
      withActor(member, (tx) => tx.update(tasks).set({ title: "Renamed" }).where(eq(tasks.id, task.id))),
      /task details/,
    );
    await expectDbError(
      withActor(member, (tx) =>
        tx.update(tasks).set({ status: "WAIVED", waivedReason: "skip" }).where(eq(tasks.id, task.id)),
      ),
      /waive/,
    );
  });

  it("members cannot update someone else's task (no rows match)", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const colleague = await createUser("TEAM_MEMBER");
    const project = await createProject(pm.id);
    await assign(project.id, member.id);
    const task = await createTask(project.id, colleague.id);

    const changed = await withActor(member, (tx) =>
      tx.update(tasks).set({ status: "IN_PROGRESS" }).where(eq(tasks.id, task.id)).returning(),
    );
    expect(changed).toHaveLength(0);
  });
});

describe("row-level security: money", () => {
  it("members see only their own ledger entries", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const colleague = await createUser("TEAM_MEMBER");
    const project = await createProject(pm.id);
    const own = await createLedgerEntry(project.id, member.id, pm.id);
    const theirs = await createLedgerEntry((await createProject(pm.id)).id, colleague.id, pm.id);

    const rows = await withActor(member, (tx) => tx.select({ id: payoutLedgerEntries.id }).from(payoutLedgerEntries));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(own.entry.id);
    expect(ids).not.toContain(theirs.entry.id);
  });

  it("only Admins can record payments (decision 4)", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const admin = await createUser("ADMIN");
    const member = await createUser("TEAM_MEMBER");
    const project = await createProject(pm.id);
    const { entry } = await createLedgerEntry(project.id, member.id, pm.id);
    const payment = (recordedBy: string) => ({
      ledgerEntryId: entry.id,
      amountMinor: 50_000,
      method: "MOBILE_MONEY" as const,
      paidAt: new Date(),
      recordedBy,
    });

    await expectDbError(
      withActor(pm, (tx) => tx.insert(paymentTransactions).values(payment(pm.id))),
      /row-level security/,
    );
    await withActor(admin, (tx) => tx.insert(paymentTransactions).values(payment(admin.id)));
  });

  it("approved snapshot lines and payments can never be edited, even by the owner connection", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const project = await createProject(pm.id);
    const { line } = await createLedgerEntry(project.id, member.id, pm.id);

    await expectDbError(
      db.update(compensationSnapshotLines).set({ amountOwedMinor: 1 }).where(eq(compensationSnapshotLines.id, line.id)),
      /append-only/,
    );
    await expectDbError(
      db.delete(compensationSnapshotLines).where(eq(compensationSnapshotLines.id, line.id)),
      /append-only/,
    );
  });
});

describe("row-level security: audit trail", () => {
  it("audit events are append-only", async () => {
    const admin = await createUser("ADMIN");
    const entityId = randomUUID();
    await withActor(admin, (tx) =>
      recordAudit(tx, { actorId: admin.id, entityType: "test", entityId, action: "test.created" }),
    );
    await expectDbError(
      db.update(auditEvents).set({ action: "tampered" }).where(eq(auditEvents.entityId, entityId)),
      /append-only/,
    );
    await expectDbError(
      db.execute(sql`delete from audit_events where entity_id = ${entityId}`),
      /append-only/,
    );
  });

  it("nobody can write an audit event in someone else's name", async () => {
    const member = await createUser("TEAM_MEMBER");
    const admin = await createUser("ADMIN");
    await expectDbError(
      withActor(member, (tx) =>
        recordAudit(tx, { actorId: admin.id, entityType: "test", entityId: randomUUID(), action: "forged" }),
      ),
      /row-level security/,
    );
  });

  it("members see only their own actions in the audit log", async () => {
    const member = await createUser("TEAM_MEMBER");
    const admin = await createUser("ADMIN");
    const entityId = randomUUID();
    await withActor(admin, (tx) =>
      recordAudit(tx, { actorId: admin.id, entityType: "test", entityId, action: "admin.only" }),
    );
    const rows = await withActor(member, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.entityId, entityId)),
    );
    expect(rows).toHaveLength(0);
  });
});
