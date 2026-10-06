import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import {
  auditEvents,
  compensationSnapshotLines,
  compensationSnapshots,
  paymentTransactions,
  payoutLedgerEntries,
  projects,
} from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import {
  approveProject,
  getProjectPayouts,
  rejectProject,
  reopenProject,
  requestApproval,
} from "@/modules/approvals";
import { ServiceError } from "@/modules/errors";
import { getProjectFinance } from "@/modules/finance";
import { listLedger } from "@/modules/ledger";
import { getProjectStatement } from "@/modules/reports/statement";
import { changeProjectStatus, createProject, getProjectWorkspace, updateProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { createTask, updateTaskProgress, waiveTask } from "@/modules/tasks";
import { getMyWork } from "@/modules/work";
import { createUser, db, expectDbError } from "./fixtures";

const today = new Date().toISOString().slice(0, 10);

/** An in-progress project worth GHS 100.01, split 50/50 between two members, one task each. */
async function setup({ finishTasks = true } = {}) {
  const pm = await createUser("PROJECT_MANAGER");
  const admin = await createUser("ADMIN");
  const a = await createUser("TEAM_MEMBER");
  const b = await createUser("TEAM_MEMBER");
  const project = await createProject(pm, {
    name: `Approval ${crypto.randomUUID().slice(0, 6)}`,
    clientType: "EXTERNAL",
    clientName: "Acme Ltd",
    totalValue: "100.01",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Backend", split: "50" });
  await addAssignment(pm, project.id, { memberId: b.id, roleOnProject: "Frontend", split: "50" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  const ta = await createTask(pm, project.id, { title: "API", assignedTo: a.id });
  const tb = await createTask(pm, project.id, { title: "UI", assignedTo: b.id });
  if (finishTasks) {
    await updateTaskProgress(a, ta.id, { status: "DONE", completionNote: "API done", completedOn: today });
    await updateTaskProgress(b, tb.id, { status: "DONE", completionNote: "UI done", completedOn: today });
  }
  return { pm, admin, a, b, project, ta, tb };
}

const version = async (projectId: string) =>
  (await db.select({ v: projects.version }).from(projects).where(eq(projects.id, projectId)))[0].v;

describe("requesting approval", () => {
  it("an assigned member can request approval; the project locks and managers are notified", async () => {
    const { a, pm, project } = await setup();
    await requestApproval(a, project.id, "All done");
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row.status).toBe("PENDING_APPROVAL");
    await expect(
      updateProject(pm, project.id, {
        name: "Edited",
        clientType: "INTERNAL",
        totalValue: "1",
        splitMode: "PERCENTAGE",
        projectOwnerId: pm.id,
        version: row.version,
      }),
    ).rejects.toThrow(/locked/);
  });

  it("outsiders cannot request approval, and draft projects cannot be submitted", async () => {
    const { project } = await setup();
    const outsider = await createUser("TEAM_MEMBER");
    await expect(requestApproval(outsider, project.id)).rejects.toThrow(/not found/);

    const pm = await createUser("PROJECT_MANAGER");
    const draft = await createProject(pm, {
      name: "Draft",
      clientType: "INTERNAL",
      totalValue: "1",
      splitMode: "PERCENTAGE",
      projectOwnerId: pm.id,
    });
    await expect(requestApproval(pm, draft.id)).rejects.toThrow(/in progress/);
  });
});

describe("approving", () => {
  it("team members cannot approve", async () => {
    const { a, project } = await setup();
    await requestApproval(a, project.id);
    await expect(approveProject(a, project.id, { expectedVersion: await version(project.id) })).rejects.toThrow(
      PermissionError,
    );
  });

  it("only a project pending approval can be approved", async () => {
    const { pm, project } = await setup();
    await expect(approveProject(pm, project.id, { expectedVersion: await version(project.id) })).rejects.toThrow(
      /waiting for approval/,
    );
  });

  it("freezes the snapshot, creates one ledger entry per recipient, reconciles exactly and audits", async () => {
    const { pm, a, b, project } = await setup();
    await requestApproval(a, project.id);
    const result = await approveProject(pm, project.id, { expectedVersion: await version(project.id) });

    const snapshots = await db.select().from(compensationSnapshots).where(eq(compensationSnapshots.projectId, project.id));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].projectTotalValueMinor).toBe(10_001);
    expect(snapshots[0].calculationNotes).toMatch(/1 pesewa/);

    const lines = await db.select().from(compensationSnapshotLines).where(eq(compensationSnapshotLines.snapshotId, result.snapshotId));
    const ledger = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id));
    expect(ledger).toHaveLength(2);
    expect(ledger.reduce((s, e) => s + e.amountOwedMinor, 0)).toBe(10_001);
    expect(lines.reduce((s, l) => s + l.amountOwedMinor, 0)).toBe(10_001);
    expect(Object.fromEntries(ledger.map((e) => [e.memberId, e.amountOwedMinor]))).toEqual({ [a.id]: 5_001, [b.id]: 5_000 });
    for (const entry of ledger) {
      expect(entry.status).toBe("OWED");
      expect(entry.approvedBy).toBe(pm.id);
      expect(lines.find((l) => l.id === entry.snapshotLineId)?.amountOwedMinor).toBe(entry.amountOwedMinor);
    }

    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row.status).toBe("COMPLETED");
    expect(row.approvedBy).toBe(pm.id);
    const [event] = await db.select().from(auditEvents).where(sql`${auditEvents.entityId} = ${project.id} and ${auditEvents.action} = 'project.approved'`);
    expect(event.actorId).toBe(pm.id);
  });

  it("can only happen once: a repeat or a second approver changes nothing", async () => {
    const { pm, admin, a, project } = await setup();
    await requestApproval(a, project.id);
    const v = await version(project.id);
    await approveProject(pm, project.id, { expectedVersion: v });
    await expect(approveProject(pm, project.id, { expectedVersion: v })).rejects.toThrow(/already been approved/);
    await expect(approveProject(admin, project.id, { expectedVersion: v + 1 })).rejects.toThrow(/already been approved/);
    expect(await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id))).toHaveLength(2);
  });

  it("concurrent approvals produce exactly one snapshot and one set of ledger entries", async () => {
    const { pm, admin, a, project } = await setup();
    await requestApproval(a, project.id);
    const v = await version(project.id);
    const results = await Promise.allSettled([
      approveProject(pm, project.id, { expectedVersion: v }),
      approveProject(admin, project.id, { expectedVersion: v }),
      approveProject(pm, project.id, { expectedVersion: v }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(compensationSnapshots).where(eq(compensationSnapshots.projectId, project.id))).toHaveLength(1);
    expect(await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id))).toHaveLength(2);
  });

  it("refuses a stale review (the project changed after the approver opened it)", async () => {
    const { pm, a, project } = await setup();
    const before = await version(project.id);
    await requestApproval(a, project.id);
    await expect(approveProject(pm, project.id, { expectedVersion: before })).rejects.toThrow(/changed since you opened it/);
  });

  it("refuses an invalid plan and creates nothing", async () => {
    const { pm, a, project } = await setup();
    // Break the plan: make the percentages total 110% (owner connection, simulating bad data).
    await db.execute(sql`update project_assignments set split_basis_points = 6000 where member_id = ${a.id}`);
    await requestApproval(a, project.id);
    await expect(approveProject(pm, project.id, { expectedVersion: await version(project.id) })).rejects.toThrow(
      /Compensation plan/,
    );
    expect(await db.select().from(compensationSnapshots).where(eq(compensationSnapshots.projectId, project.id))).toHaveLength(0);
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row.status).toBe("PENDING_APPROVAL");
  });

  it("incomplete required tasks need an override reason, which is recorded", async () => {
    const { pm, a, project } = await setup({ finishTasks: false });
    await requestApproval(a, project.id);
    const v = await version(project.id);
    await expect(approveProject(pm, project.id, { expectedVersion: v })).rejects.toThrow(/override reason/);
    await approveProject(pm, project.id, { expectedVersion: v, overrideReason: "Client accepted delivery as is" });
    const [event] = await db.select().from(auditEvents).where(sql`${auditEvents.entityId} = ${project.id} and ${auditEvents.action} = 'project.approved'`);
    expect(event.reason).toBe("Client accepted delivery as is");
    expect((event.afterJson as { overriddenTasks: unknown[] }).overriddenTasks).toHaveLength(2);
  });

  it("waived tasks do not block approval", async () => {
    const { pm, a, project, ta, tb } = await setup({ finishTasks: false });
    await updateTaskProgress(a, ta.id, { status: "DONE", completionNote: "Done", completedOn: today });
    await waiveTask(pm, tb.id, "Client dropped the UI");
    await requestApproval(a, project.id);
    await approveProject(pm, project.id, { expectedVersion: await version(project.id) });
  });

  it("zero-amount lines are kept in the snapshot but create no payout", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const a = await createUser("TEAM_MEMBER");
    const volunteer = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, {
      name: "Zero line",
      clientType: "INTERNAL",
      totalValue: "50",
      splitMode: "PERCENTAGE",
      projectOwnerId: pm.id,
    });
    await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "100" });
    await addAssignment(pm, project.id, { memberId: volunteer.id, roleOnProject: "Mentor", split: "0" });
    await changeProjectStatus(pm, project.id, { to: "PLANNING" });
    await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
    await requestApproval(pm, project.id);
    const result = await approveProject(pm, project.id, { expectedVersion: await version(project.id) });
    expect(result.ledgerEntries).toBe(1);
    expect(await db.select().from(compensationSnapshotLines).where(eq(compensationSnapshotLines.snapshotId, result.snapshotId))).toHaveLength(2);
  });
});

describe("after approval", () => {
  it("members see their own payout in My Work and cannot alter it", async () => {
    const { pm, a, b, project } = await setup();
    await requestApproval(a, project.id);
    await approveProject(pm, project.id, { expectedVersion: await version(project.id) });

    const work = await getMyWork(a);
    expect(work.payouts.owedMinor).toBe(5_001);
    expect(work.payouts.rows).toHaveLength(1);
    expect(work.unreadNotifications.some((n) => n.type === "payout.created")).toBe(true);

    const payouts = await getProjectPayouts(a, project.id);
    expect(payouts[0].lines.map((l) => l.memberId)).toEqual([a.id]);

    const changed = await withActor(a, (tx) =>
      tx.update(payoutLedgerEntries).set({ status: "PAID" }).where(eq(payoutLedgerEntries.memberId, a.id)).returning(),
    );
    expect(changed).toHaveLength(0);
    expect((await getMyWork(b)).payouts.owedMinor).toBe(5_000);
  });

  it("ledger amounts can never be changed, even by an Admin or the owner connection", async () => {
    const { pm, admin, a, project } = await setup();
    await requestApproval(a, project.id);
    await approveProject(pm, project.id, { expectedVersion: await version(project.id) });
    await expectDbError(
      withActor(admin, (tx) =>
        tx.update(payoutLedgerEntries).set({ amountOwedMinor: 1 }).where(eq(payoutLedgerEntries.projectId, project.id)),
      ),
      /fixed at approval/,
    );
    await expectDbError(db.delete(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id)), /cannot be deleted/);
  });

  it("a project cannot be marked completed except by the approval transaction", async () => {
    const { pm, a, project } = await setup();
    await requestApproval(a, project.id);
    await expectDbError(
      withActor(pm, (tx) => tx.update(projects).set({ status: "COMPLETED" }).where(eq(projects.id, project.id))),
      /approval transaction/,
    );
  });

  it("the ledger lists entries with totals for managers only", async () => {
    const { pm, a, project } = await setup();
    await requestApproval(a, project.id);
    await approveProject(pm, project.id, { expectedVersion: await version(project.id) });
    const ledger = await listLedger(pm, { projectId: project.id });
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.totals.owedMinor).toBe(10_001);
    await expect(listLedger(a)).rejects.toThrow(PermissionError);
  });
});

describe("returning and reopening", () => {
  it("a manager returns a submitted project with a reason; it becomes editable again", async () => {
    const { pm, a, project } = await setup();
    await requestApproval(a, project.id);
    await expect(rejectProject(pm, project.id, "")).rejects.toThrow();
    await expect(rejectProject(a, project.id, "Not good")).rejects.toThrow(PermissionError);
    await rejectProject(pm, project.id, "Add the deployment notes");
    const ws = await getProjectWorkspace(pm, project.id);
    expect(ws?.project.status).toBe("CHANGES_REQUESTED");
    await requestApproval(a, project.id, "Notes added");
    await approveProject(pm, project.id, { expectedVersion: await version(project.id) });
  });

  it("only Admins reopen, with a reason; payouts are voided and re-approval creates snapshot 2", async () => {
    const { pm, admin, a, project } = await setup();
    await requestApproval(a, project.id);
    await approveProject(pm, project.id, { expectedVersion: await version(project.id) });

    await expect(reopenProject(pm, project.id, "Wrong split")).rejects.toThrow(PermissionError);
    await expect(reopenProject(admin, project.id, "")).rejects.toThrow();
    await reopenProject(admin, project.id, "Split agreed differently");

    const voided = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id));
    expect(voided.every((e) => e.status === "VOIDED")).toBe(true);
    expect((await getMyWork(a)).payouts.rows.every((r) => r.status === "VOIDED")).toBe(true);
    expect((await listLedger(pm, { projectId: project.id })).totals.owedMinor).toBe(0);

    await requestApproval(a, project.id);
    const second = await approveProject(pm, project.id, { expectedVersion: await version(project.id) });
    expect(second.sequence).toBe(2);
    const payouts = await getProjectPayouts(pm, project.id);
    expect(payouts.map((s) => s.sequence)).toEqual([1, 2]);
    expect((await listLedger(pm, { projectId: project.id })).totals.owedMinor).toBe(10_001);
  });

  it("reopening is refused once a payment was recorded", async () => {
    const { pm, admin, a, project } = await setup();
    await requestApproval(a, project.id);
    await approveProject(pm, project.id, { expectedVersion: await version(project.id) });
    const [entry] = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id));
    await db.insert(paymentTransactions).values({
      ledgerEntryId: entry.id,
      amountMinor: 100,
      method: "CASH",
      paidAt: new Date(),
      recordedBy: admin.id,
    });
    await expect(reopenProject(admin, project.id, "Too late")).rejects.toThrow(ServiceError);
  });
});

describe("AGOD share", () => {
  async function shareProject(splits: [string, string], extra: Partial<Parameters<typeof createProject>[1]> = {}) {
    const pm = await createUser("PROJECT_MANAGER");
    const a = await createUser("TEAM_MEMBER");
    const b = await createUser("TEAM_MEMBER");
    const project = await createProject(pm, {
      name: `Share ${crypto.randomUUID().slice(0, 6)}`,
      clientType: "EXTERNAL",
      clientName: "Acme Ltd",
      totalValue: "100.01",
      splitMode: "PERCENTAGE",
      agodShare: "30",
      projectOwnerId: pm.id,
      ...extra,
    });
    await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Backend", split: splits[0] });
    await addAssignment(pm, project.id, { memberId: b.id, roleOnProject: "Frontend", split: splits[1] });
    await changeProjectStatus(pm, project.id, { to: "PLANNING" });
    await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
    return { pm, a, b, project };
  }

  it("the team must total 100% minus the AGOD share", async () => {
    const { pm, project } = await shareProject(["50", "50"]);
    expect(project.agodShareBasisPoints).toBe(3_000);
    const ws = (await getProjectWorkspace(pm, project.id))!;
    expect(ws.compensation?.errors.join()).toMatch(/total exactly 70.00%/);
    await expect(
      (async () => {
        await requestApproval(pm, project.id);
        await approveProject(pm, project.id, { expectedVersion: await version(project.id) });
      })(),
    ).rejects.toThrow(ServiceError);
    expect(await db.select().from(compensationSnapshots).where(eq(compensationSnapshots.projectId, project.id))).toHaveLength(0);
  });

  it("records what AGOD keeps in the snapshot; members get exact floors and profit equals the share", async () => {
    const { pm, a, b, project } = await shareProject(["35", "35"]);
    await requestApproval(pm, project.id);
    await approveProject(pm, project.id, { expectedVersion: await version(project.id), overrideReason: "No tasks in this test" });

    const [snapshot] = await db.select().from(compensationSnapshots).where(eq(compensationSnapshots.projectId, project.id));
    expect(snapshot).toMatchObject({ agodShareBasisPoints: 3_000, agodShareMinor: 3_001, calculationVersion: 2 });
    expect(snapshot.calculationNotes).toMatch(/AGOD share \(30%\): GHS 30.01/);
    const ledger = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, project.id));
    expect(Object.fromEntries(ledger.map((e) => [e.memberId, e.amountOwedMinor]))).toEqual({ [a.id]: 3_500, [b.id]: 3_500 });

    const finance = (await getProjectFinance(pm, project.id))!;
    expect(finance.financials).toMatchObject({ revenueMinor: 10_001, committedPayoutMinor: 7_000, actualProfitMinor: 3_001 });
    const statement = (await getProjectStatement(pm, project.id))!;
    expect(statement.checks.every((c) => c.ok)).toBe(true);
    expect(statement.checks.map((c) => c.label).join()).toMatch(/plus the AGOD share equal/);
  });

  it("fixed-amount projects keep no share percentage, and the database refuses one", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const project = await createProject(pm, {
      name: `Fixed ${crypto.randomUUID().slice(0, 6)}`,
      clientType: "INTERNAL",
      totalValue: "100",
      splitMode: "FIXED_AMOUNT",
      agodShare: "30",
      projectOwnerId: pm.id,
    });
    expect(project.agodShareBasisPoints).toBe(0);
    await expectDbError(db.update(projects).set({ agodShareBasisPoints: 1_000 }).where(eq(projects.id, project.id)), /projects_agod_share_valid/);
    await expect(updateProject(pm, project.id, { ...project, totalValue: "100", splitMode: "PERCENTAGE", agodShare: "120", clientName: null, version: project.version })).rejects.toThrow(/AGOD share/);
  });
});
