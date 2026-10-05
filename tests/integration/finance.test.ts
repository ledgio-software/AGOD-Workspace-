import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { payoutLedgerEntries, projectCosts, projects } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { PermissionError } from "@/lib/permissions";
import { approveProject, requestApproval } from "@/modules/approvals";
import { ServiceError } from "@/modules/errors";
import {
  getPayoutAging,
  getPayoutForecast,
  getProfitability,
  getProjectFinance,
  getUtilisation,
  recordCost,
  setProjectFinance,
  voidCost,
} from "@/modules/finance";
import { addDays } from "@/modules/notifications/deadlines";
import { createAdjustment, recordPayment } from "@/modules/payments";
import { changeProjectStatus, createProject } from "@/modules/projects";
import { addAssignment } from "@/modules/projects/team";
import { createTask, updateTaskProgress } from "@/modules/tasks";
import { createUser, db, expectDbError } from "./fixtures";

const today = todayInOperatingZone();
const uniq = () => crypto.randomUUID().slice(0, 6);

async function setup(clientType: "INTERNAL" | "EXTERNAL" = "EXTERNAL") {
  const pm = await createUser("PROJECT_MANAGER");
  const admin = await createUser("ADMIN");
  const a = await createUser("TEAM_MEMBER");
  const b = await createUser("TEAM_MEMBER");
  const client = `Client ${uniq()}`;
  const project = await createProject(pm, {
    name: `Fin ${uniq()}`,
    clientType,
    clientName: clientType === "EXTERNAL" ? client : undefined,
    totalValue: "1000",
    splitMode: "PERCENTAGE",
    projectOwnerId: pm.id,
    targetDate: addDays(today, 40),
  });
  await addAssignment(pm, project.id, { memberId: a.id, roleOnProject: "Dev", split: "60" });
  await addAssignment(pm, project.id, { memberId: b.id, roleOnProject: "QA", split: "40" });
  await changeProjectStatus(pm, project.id, { to: "PLANNING" });
  await changeProjectStatus(pm, project.id, { to: "IN_PROGRESS" });
  return { pm, admin, a, b, client, project };
}

async function approve(pm: Awaited<ReturnType<typeof setup>>["pm"], projectId: string) {
  await requestApproval(pm, projectId);
  const [{ version }] = await db.select({ version: projects.version }).from(projects).where(eq(projects.id, projectId));
  await approveProject(pm, projectId, { expectedVersion: version });
}

describe("project finance", () => {
  it("computes planned then actual profit from splits, approvals, adjustments and costs", async () => {
    const { pm, admin, a, project } = await setup();
    await setProjectFinance(pm, project.id, { category: "WEBSITE", costBudget: "100" });
    await recordCost(pm, project.id, { category: "HOSTING", description: "Vercel Pro", amount: "60.00", incurredOn: today });
    const wrong = await recordCost(pm, project.id, { category: "SOFTWARE", description: "Typo cost", amount: "999", incurredOn: today });
    await voidCost(pm, wrong.id, "Entered by mistake");

    let f = (await getProjectFinance(pm, project.id))!;
    expect(f.category).toBe("WEBSITE");
    expect(f.financials).toMatchObject({
      revenueMinor: 100_000,
      plannedPayoutMinor: 100_000,
      actualCostMinor: 6_000,
      estimatedProfitMinor: 100_000 - 100_000 - 10_000,
      actualProfitMinor: 100_000 - 100_000 - 6_000,
      actualMarginPct: -6,
      approved: false,
    });

    await approve(pm, project.id);
    const [entry] = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.memberId, a.id));
    await createAdjustment(admin, entry.id, { type: "INCREASE", amount: "10", reason: "Extra page" });
    await recordPayment(admin, entry.id, { amount: "100", method: "CASH", paidOn: today });
    f = (await getProjectFinance(pm, project.id))!;
    expect(f.financials).toMatchObject({ approved: true, committedPayoutMinor: 101_000, paidPayoutMinor: 10_000, outstandingPayoutMinor: 91_000, actualProfitMinor: 100_000 - 101_000 - 6_000 });
  });

  it("internal projects have no revenue", async () => {
    const { pm, project } = await setup("INTERNAL");
    const f = (await getProjectFinance(pm, project.id))!;
    expect(f.financials).toMatchObject({ revenueMinor: 0, actualMarginPct: null, actualProfitMinor: -100_000 });
  });

  it("members can't see or record costs, and costs can't be edited or deleted", async () => {
    const { pm, a, project } = await setup();
    await expect(getProjectFinance(a, project.id)).rejects.toThrow(PermissionError);
    await expect(recordCost(a, project.id, { category: "OTHER", description: "Lunch", amount: "5", incurredOn: today })).rejects.toThrow(PermissionError);
    await expect(recordCost(pm, project.id, { category: "OTHER", description: "Future", amount: "5", incurredOn: addDays(today, 2) })).rejects.toThrow(ServiceError);
    const cost = await recordCost(pm, project.id, { category: "TRAVEL", description: "Client visit", amount: "40", incurredOn: today });
    expect(await withActor(a, (tx) => tx.select().from(projectCosts).where(eq(projectCosts.projectId, project.id)))).toEqual([]);
    await expectDbError(
      withActor(a, (tx) => tx.insert(projectCosts).values({ projectId: project.id, category: "OTHER", description: "Sneaky", amountMinor: 1, incurredOn: today, createdBy: a.id })),
      /row-level security/,
    );
    await expectDbError(withActor(pm, (tx) => tx.update(projectCosts).set({ amountMinor: 1 }).where(eq(projectCosts.id, cost.id))), /cannot be edited/);
    await expectDbError(db.delete(projectCosts).where(eq(projectCosts.id, cost.id)), /cannot be deleted/);
    await voidCost(pm, cost.id, "Duplicate of an expense claim");
    await expect(voidCost(pm, cost.id, "again")).rejects.toThrow(/already voided/);
  });
});

describe("company reports", () => {
  it("lists projects with totals, by client and by type", async () => {
    const { pm, a, client, project } = await setup();
    await setProjectFinance(pm, project.id, { category: "MOBILE_APP", costBudget: "0" });
    await recordCost(pm, project.id, { category: "SUBCONTRACTOR", description: "Icon designer", amount: "50", incurredOn: today });
    const r = await getProfitability(pm, { scope: "active", category: "MOBILE_APP" });
    const row = r.projects.find((p) => p.id === project.id)!;
    expect(row).toMatchObject({ revenueMinor: 100_000, plannedPayoutMinor: 100_000, actualCostMinor: 5_000, actualProfitMinor: -5_000 });
    expect(r.projects.every((p) => p.category === "MOBILE_APP" && p.status !== "COMPLETED")).toBe(true);
    expect(r.byClient.find((g) => g.name === client)).toMatchObject({ projects: 1, profitMinor: -5_000, marginPct: -5 });
    expect(r.byCategory.map((g) => g.name)).toEqual(["MOBILE_APP"]);
    expect((await getProfitability(pm, { scope: "completed" })).projects.some((p) => p.id === project.id)).toBe(false);
    await expect(getProfitability(a)).rejects.toThrow(PermissionError);
  });

  it("forecasts payouts, ages unpaid balances and measures utilisation", async () => {
    const { pm, admin, a, project } = await setup();
    const t = await createTask(pm, project.id, { title: "Build", assignedTo: a.id, estimateHours: "16" });
    await updateTaskProgress(a, t.id, { status: "DONE", completionNote: "Built", completedOn: today });

    let forecast = await getPayoutForecast(pm);
    const item = forecast.pipeline.find((p) => p.id === project.id)!;
    expect(item).toMatchObject({ plannedPayoutMinor: 100_000, month: addDays(today, 40).slice(0, 7) });

    await approve(pm, project.id);
    const [entry] = await db.select().from(payoutLedgerEntries).where(eq(payoutLedgerEntries.memberId, a.id));
    await recordPayment(admin, entry.id, { amount: "100", method: "CASH", paidOn: today });
    forecast = await getPayoutForecast(pm);
    expect(forecast.pipeline.some((p) => p.id === project.id)).toBe(false);
    expect(forecast.rows[0].owedNowMinor).toBeGreaterThanOrEqual(40_000);

    const aging = await getPayoutAging(pm);
    expect(aging.buckets[0].remainingMinor).toBeGreaterThanOrEqual(40_000);
    expect(aging.oldest.length).toBeGreaterThan(0);

    const u = await getUtilisation(pm, today.slice(0, 7));
    expect(u.rows.find((r) => r.id === a.id)).toMatchObject({ tasksCompleted: 1, completedHours: 16 });
    await expect(getUtilisation(a)).rejects.toThrow(PermissionError);
  });
});
