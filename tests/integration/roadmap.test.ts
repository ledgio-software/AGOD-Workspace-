import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, notifications, payoutPeriods, payoutQuestions, payoutLedgerEntries, projects, tasks } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { PermissionError } from "@/lib/permissions";
import { approveProject, requestApproval } from "@/modules/approvals";
import { ServiceError } from "@/modules/errors";
import { refreshDeadlineAlerts } from "@/modules/notifications/deadlines";
import { getPayout, recordPayment } from "@/modules/payments";
import { closePeriod, currentPeriod, getPeriodClose, periodEnd, previousPeriod, reopenPeriod } from "@/modules/periods";
import { changeProjectStatus, createProject, getProjectWorkspace, setHealthOverride } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { raiseQuestion, resolveQuestion, reviewQuestion, questionsForPayout } from "@/modules/questions";
import { createTask, updateTaskProgress } from "@/modules/tasks";
import { getContributionHistory } from "@/modules/work/history";
import { addDays } from "@/modules/notifications/deadlines";
import { createUser, db, expectDbError } from "./fixtures";

const today = todayInOperatingZone();

async function inProgress() {
  const pm = await createUser("PROJECT_MANAGER");
  const admin = await createUser("ADMIN");
  const a = await createUser("TEAM_MEMBER");
  const b = await createUser("TEAM_MEMBER");
  const project = await createProject(pm, {
    name: `Roadmap ${crypto.randomUUID().slice(0, 6)}`,
    clientType: "INTERNAL",
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
  });
  await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "60" });
  await addAssignment(pm, project.id, { memberId: b.id, roleOnProject: "QA", split: "40" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  return { pm, admin, a, b, project };
}

async function approved() {
  const ctx = await inProgress();
  await requestApproval(ctx.pm, ctx.project.id);
  const [{ version }] = await db.select({ version: projects.version }).from(projects).where(eq(projects.id, ctx.project.id));
  await approveProject(ctx.pm, ctx.project.id, { expectedVersion: version });
  const entries = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.projectId, ctx.project.id));
  return { ...ctx, entryA: entries.find((e) => e.memberId === ctx.a.id)!, entryB: entries.find((e) => e.memberId === ctx.b.id)! };
}

describe("health override", () => {
  it("replaces the calculated health with a reason, and can be cleared", async () => {
    const { pm, a, project } = await inProgress();
    await expect(setHealthOverride(a, project.id, { health: "AT_RISK", reason: "Client is slow" })).rejects.toThrow(PermissionError);
    await expect(setHealthOverride(pm, project.id, { health: "AT_RISK", reason: "" })).rejects.toThrow();

    await setHealthOverride(pm, project.id, { health: "AT_RISK", reason: "Client feedback is late" });
    let ws = (await getProjectWorkspace(pm, project.id))!;
    expect(ws.health).toBe("AT_RISK");
    expect(ws.calculatedHealth).toBe("ON_TRACK");
    expect(ws.healthOverride?.reason).toBe("Client feedback is late");

    await setHealthOverride(pm, project.id, { health: "", reason: "Feedback arrived" });
    ws = (await getProjectWorkspace(pm, project.id))!;
    expect(ws.health).toBe("ON_TRACK");
    expect(ws.healthOverride).toBeNull();

    const actions = (await db.select().from(auditEvents).where(eq(auditEvents.projectId, project.id))).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["project.health_overridden", "project.health_override_cleared"]));
  });

  it("the database refuses an override without a reason", async () => {
    const { pm, project } = await inProgress();
    await expectDbError(
      withActor(pm, (tx) => tx.update(projects).set({ healthOverride: "BLOCKED", healthOverrideBy: pm.id }).where(eq(projects.id, project.id))),
      /projects_health_override_has_reason/,
    );
  });
});

describe("deadline alerts", () => {
  it("alerts the assignee and the project owner once per due date", async () => {
    const { pm, a, b, project } = await inProgress();
    const late = await createTask(pm, project.id, { title: "Late task", assignedTo: a.id, dueDate: addDays(today, -1) });
    await createTask(pm, project.id, { title: "Due today", assignedTo: a.id, dueDate: today });
    await createTask(pm, project.id, { title: "Later", assignedTo: a.id, dueDate: addDays(today, 10) });
    const done = await createTask(pm, project.id, { title: "Done late", assignedTo: b.id, dueDate: addDays(today, -3) });
    await updateTaskProgress(b, done.id, { status: "DONE", completionNote: "Finished", completedOn: today });

    expect(await refreshDeadlineAlerts(a)).toBe(2);
    expect(await refreshDeadlineAlerts(a)).toBe(0);
    expect(await refreshDeadlineAlerts(b)).toBe(0);
    expect(await refreshDeadlineAlerts(pm)).toBe(1);

    const mine = await db.select().from(notifications).where(eq(notifications.recipientId, a.id));
    expect(mine.filter((n) => n.dedupeKey).map((n) => n.type).sort()).toEqual(["task.due_soon", "task.overdue"]);

    // Moving the deadline produces a fresh alert.
    await db.update(tasks).set({ dueDate: addDays(today, -2) }).where(eq(tasks.id, late.id));
    expect(await refreshDeadlineAlerts(a)).toBe(1);
  });
});

describe("payout questions", () => {
  it("member asks, PM answers with no change", async () => {
    const { pm, a, entryA, entryB } = await approved();
    await expect(raiseQuestion(a, entryB.id, { question: "Why is my share 40%?" })).rejects.toThrow(ServiceError);
    await expect(raiseQuestion(a, entryA.id, { question: "short" })).rejects.toThrow();
    const q = await raiseQuestion(a, entryA.id, { question: "Should the weekend work be included?" });
    expect(q.status).toBe("OPEN");

    await expect(reviewQuestion(a, q.id, { outcome: "NO_CHANGE", note: "ok" })).rejects.toThrow(PermissionError);
    const reviewed = await reviewQuestion(pm, q.id, { outcome: "NO_CHANGE", note: "Weekend work was part of the agreed scope" });
    expect(reviewed.status).toBe("RESOLVED");
    await expect(reviewQuestion(pm, q.id, { outcome: "NO_CHANGE", note: "again" })).rejects.toThrow(ServiceError);
    const owner = await db.select().from(notifications).where(and(eq(notifications.recipientId, pm.id), eq(notifications.type, "payout_question.raised")));
    expect(owner).toHaveLength(1);
  });

  it("PM sends it to an Admin, who records the adjustment in the same step", async () => {
    const { pm, admin, a, entryA } = await approved();
    const q = await raiseQuestion(a, entryA.id, { question: "The extra API work was not included." });
    await reviewQuestion(pm, q.id, { outcome: "NEEDS_ADJUSTMENT", note: "Agreed: add GHS 50" });
    await expect(resolveQuestion(pm, q.id, { resolution: "x" })).rejects.toThrow(PermissionError);
    await expectDbError(
      withActor(pm, (tx) => tx.update(payoutQuestions).set({ reviewNote: "changed" }).where(eq(payoutQuestions.id, q.id))),
      /Only an Admin/,
    );

    const resolved = await resolveQuestion(admin, q.id, {
      resolution: "Extra API work added",
      adjustment: { type: "INCREASE", amount: "50.00", reason: "Extra API work added" },
    });
    expect(resolved.adjustmentId).not.toBeNull();
    const payout = (await getPayout(a, entryA.id))!;
    expect(payout.balance.effectiveOwedMinor).toBe(60_000 + 5_000);
    expect(payout.adjustments).toHaveLength(1);

    await expectDbError(
      withActor(admin, (tx) => tx.update(payoutQuestions).set({ resolution: "rewritten" }).where(eq(payoutQuestions.id, q.id))),
      /already resolved/,
    );
  });

  it("row-level security: members see and raise only their own", async () => {
    const { a, b, entryA, entryB } = await approved();
    await raiseQuestion(a, entryA.id, { question: "Question about my own payout" });
    expect(await questionsForPayout(b, entryA.id)).toHaveLength(0);
    await expectDbError(
      withActor(b, (tx) =>
        tx.insert(payoutQuestions).values({ ledgerEntryId: entryA.id, projectId: entryA.projectId, raisedBy: b.id, question: "Not my payout" }),
      ),
      /row-level security/,
    );
    await expectDbError(
      withActor(a, (tx) =>
        tx.insert(payoutQuestions).values({ ledgerEntryId: entryB.id, projectId: entryB.projectId, raisedBy: a.id, question: "Someone else's" }),
      ),
      /row-level security/,
    );
  });
});

describe("contribution history", () => {
  it("shows a member's work and payouts to managers and to themselves only", async () => {
    const { pm, admin, a, b, project, entryA } = await approved();
    await recordPayment(admin, entryA.id, { amount: "100.00", method: "CASH", paidOn: today });
    const h = (await getContributionHistory(pm, a.id))!;
    expect(h.projects.map((p) => p.id)).toContain(project.id);
    expect(h.totals.owedMinor).toBe(60_000);
    expect(h.totals.paidMinor).toBe(10_000);
    expect(h.payments).toHaveLength(1);
    expect((await getContributionHistory(a, a.id))?.member.id).toBe(a.id);
    await expect(getContributionHistory(b, a.id)).rejects.toThrow(PermissionError);
  });
});

describe("month close", () => {
  it("closes a finished month, refuses payments dated in it, and reopens with a reason", async () => {
    const { pm, admin, entryA } = await approved();
    const last = previousPeriod(currentPeriod());
    const lastDay = periodEnd(last);

    await expect(closePeriod(admin, currentPeriod(), "")).rejects.toThrow(ServiceError);
    await expect(closePeriod(pm, last, "")).rejects.toThrow(PermissionError);
    await expectDbError(
      withActor(pm, (tx) => tx.insert(payoutPeriods).values({ period: last, locked: true, lockedBy: pm.id, lockedAt: new Date() })),
      /row-level security/,
    );
    await expectDbError(
      withActor(admin, (tx) => tx.insert(payoutPeriods).values({ period: currentPeriod(), locked: true, lockedBy: admin.id, lockedAt: new Date() })),
      /finished month/,
    );

    await closePeriod(admin, last, "Reviewed");
    try {
      await expect(recordPayment(admin, entryA.id, { amount: "10.00", method: "CASH", paidOn: lastDay })).rejects.toThrow(/is closed/);
      await recordPayment(admin, entryA.id, { amount: "10.00", method: "CASH", paidOn: today });
      await expect(closePeriod(admin, last, "")).rejects.toThrow(/already closed/);
      await expect(reopenPeriod(admin, last, "")).rejects.toThrow();
      await expectDbError(
        withActor(admin, (tx) => tx.update(payoutPeriods).set({ locked: false }).where(eq(payoutPeriods.period, last))),
        /needs a reason/,
      );
      const close = await getPeriodClose(pm, last);
      expect(close.state?.locked).toBe(true);
    } finally {
      await reopenPeriod(admin, last, "Back-dated receipt arrived");
    }
    await recordPayment(admin, entryA.id, { amount: "10.00", method: "CASH", paidOn: lastDay });
    const close = await getPeriodClose(pm, last);
    expect(close.state?.locked).toBe(false);
    expect(close.payments.some((p) => p.ledgerEntryId === entryA.id)).toBe(true);
    const actions = (await db.select().from(auditEvents).where(eq(auditEvents.entityType, "period"))).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["period.closed", "period.reopened"]));

    // Closing again clears the last reopening, so the next reopening needs its own reason.
    await closePeriod(admin, last, "Closed again");
    try {
      const [row] = await db.select().from(payoutPeriods).where(eq(payoutPeriods.period, last));
      expect(row.unlockReason).toBeNull();
      await expectDbError(
        withActor(admin, (tx) => tx.update(payoutPeriods).set({ locked: false }).where(eq(payoutPeriods.period, last))),
        /needs a reason/,
      );
    } finally {
      await reopenPeriod(admin, last, "Leave open for other tests");
    }
  });
});
