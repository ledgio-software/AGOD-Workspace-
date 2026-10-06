import { and, asc, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { projectCosts, projects, tasks, orgMembers, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { parseMoney } from "@/lib/money";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { type LedgerRow, ledgerRowsTx } from "@/modules/ledger";
import { lockProject, previewCompensationTx } from "@/modules/projects";
import {
  type ForecastItem,
  type ProjectFinancials,
  agePayouts,
  forecastByMonth,
  groupTotals,
  projectFinancials,
  sumFinancials,
  utilisationPct,
} from "./calc";

// Profitability and business intelligence (roadmap Stage 3). Backend services; every figure is
// derived from the ledger, project values, team splits and recorded costs, so it can be explained.

export const PROJECT_CATEGORIES = ["DISCOVERY", "WEBSITE", "MOBILE_APP", "AI_INTEGRATION", "INTERNAL_PRODUCT", "MAINTENANCE", "OTHER"] as const;
export const COST_CATEGORIES = ["SOFTWARE", "HOSTING", "HARDWARE", "SUBCONTRACTOR", "TRAVEL", "MARKETING", "OTHER"] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

const money = (label: string, { allowZero = false } = {}) =>
  z.string().transform((v, ctx) => {
    const minor = parseMoney(v || (allowZero ? "0" : ""));
    if (minor === null || minor < 0 || (!allowZero && minor === 0)) {
      ctx.addIssue({ code: "custom", message: `Enter the ${label} in GHS, e.g. 250.00` });
      return z.NEVER;
    }
    return minor;
  });

export const projectFinanceInput = z.object({
  category: z.enum(PROJECT_CATEGORIES),
  costBudget: money("cost budget", { allowZero: true }),
});

export const costInput = z.object({
  category: z.enum(COST_CATEGORIES),
  description: z.string().trim().min(3, "Describe the cost (at least 3 characters)").max(300),
  vendor: z
    .string()
    .trim()
    .max(120)
    .transform((v) => v || null)
    .nullish(),
  amount: money("amount"),
  incurredOn: z.iso.date("Enter the date of the cost"),
});

/** Project type and cost budget: editable at any stage by managers (they don't change payouts). */
export async function setProjectFinance(actor: Actor, projectId: string, raw: z.input<typeof projectFinanceInput>, request?: RequestMeta) {
  assertCan(actor, "finance.manage");
  const input = projectFinanceInput.parse(raw);
  await withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    if (project.category === input.category && project.costBudgetMinor === input.costBudget) return;
    await tx.update(projects).set({ category: input.category, costBudgetMinor: input.costBudget }).where(eq(projects.id, projectId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project",
      entityId: projectId,
      projectId,
      action: "project.finance_updated",
      before: { category: project.category, costBudgetMinor: project.costBudgetMinor },
      after: { category: input.category, costBudgetMinor: input.costBudget },
      request,
    });
  });
}

export async function recordCost(actor: Actor, projectId: string, raw: z.input<typeof costInput>, request?: RequestMeta) {
  assertCan(actor, "finance.manage");
  const input = costInput.parse(raw);
  if (input.incurredOn > todayInOperatingZone()) throw new ServiceError("The cost date cannot be in the future.");
  return withActor(actor, async (tx) => {
    const project = await lockProject(tx, projectId);
    if (project.status === "CANCELLED") throw new ServiceError("This project is cancelled.");
    const [cost] = await tx
      .insert(projectCosts)
      .values({
        projectId,
        category: input.category,
        description: input.description,
        vendor: input.vendor ?? null,
        amountMinor: input.amount,
        incurredOn: input.incurredOn,
        createdBy: actor.id,
      })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project_cost",
      entityId: cost.id,
      projectId,
      action: "cost.recorded",
      after: { category: cost.category, description: cost.description, amountMinor: cost.amountMinor, incurredOn: cost.incurredOn },
      request,
    });
    return cost;
  });
}

export async function voidCost(actor: Actor, costId: string, reason: string, request?: RequestMeta) {
  assertCan(actor, "finance.manage");
  const why = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500).parse(reason);
  await withActor(actor, async (tx) => {
    const [cost] = await tx.select().from(projectCosts).where(eq(projectCosts.id, costId));
    if (!cost) throw new ServiceError("Cost not found.");
    if (cost.voidedAt) throw new ServiceError("This cost is already voided.");
    await tx
      .update(projectCosts)
      .set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: why })
      .where(eq(projectCosts.id, costId))
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "project_cost",
      entityId: costId,
      projectId: cost.projectId,
      action: "cost.voided",
      before: { amountMinor: cost.amountMinor, description: cost.description },
      reason: why,
      request,
    });
  });
}

type ProjectRow = typeof projects.$inferSelect;

/** Money facts for many projects at once, from the ledger, splits and costs. */
async function financialsFor(tx: Tx, rows: ProjectRow[], ledger: LedgerRow[]) {
  const ids = rows.map((p) => p.id);
  const costs = ids.length
    ? await tx.select({ projectId: projectCosts.projectId, amountMinor: projectCosts.amountMinor }).from(projectCosts).where(and(inArray(projectCosts.projectId, ids), isNull(projectCosts.voidedAt)))
    : [];
  const result = new Map<string, ProjectFinancials>();
  for (const p of rows) {
    const live = ledger.filter((l) => l.projectId === p.id && l.status !== "VOIDED");
    const approved = p.status === "COMPLETED";
    const committed = live.reduce((s, l) => s + l.effectiveOwedMinor, 0);
    const planned = approved ? committed : (await previewCompensationTx(tx, p)).allocatedMinor;
    result.set(
      p.id,
      projectFinancials({
        revenueMinor: p.clientType === "EXTERNAL" ? p.totalValueMinor : 0,
        plannedPayoutMinor: planned,
        committedPayoutMinor: committed,
        paidPayoutMinor: live.reduce((s, l) => s + l.paidMinor, 0),
        costBudgetMinor: p.costBudgetMinor,
        actualCostMinor: costs.filter((c) => c.projectId === p.id).reduce((s, c) => s + c.amountMinor, 0),
        approved,
      }),
    );
  }
  return result;
}

/** One project's finances and cost records (project page). */
export async function getProjectFinance(actor: Actor, projectId: string) {
  assertCan(actor, "finance.view");
  return withActor(actor, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    const ledger = await ledgerRowsTx(tx, { projectId });
    const financials = (await financialsFor(tx, [project], ledger)).get(project.id)!;
    const costs = await tx
      .select({ cost: projectCosts, createdByName: users.name })
      .from(projectCosts)
      .innerJoin(users, eq(users.id, projectCosts.createdBy))
      .where(eq(projectCosts.projectId, projectId))
      .orderBy(desc(projectCosts.incurredOn), desc(projectCosts.createdAt));
    return {
      category: project.category,
      costBudgetMinor: project.costBudgetMinor,
      clientType: project.clientType,
      financials,
      costs: costs.map((c) => ({ ...c.cost, createdByName: c.createdByName })),
    };
  });
}

export const profitabilityFilters = z.object({
  scope: z.enum(["all", "active", "completed"]).catch("all"),
  category: z.enum(PROJECT_CATEGORIES).optional().catch(undefined),
});

/** Company view: every non-cancelled project with its figures, totals, and by client and type. */
export async function getProfitability(actor: Actor, raw: z.input<typeof profitabilityFilters> = { scope: "all" }) {
  assertCan(actor, "finance.view");
  const filters = profitabilityFilters.parse(raw);
  return withActor(actor, async (tx) => {
    let rows = await tx.select().from(projects).where(ne(projects.status, "CANCELLED")).orderBy(desc(projects.createdAt));
    if (filters.scope === "active") rows = rows.filter((p) => p.status !== "COMPLETED");
    if (filters.scope === "completed") rows = rows.filter((p) => p.status === "COMPLETED");
    if (filters.category) rows = rows.filter((p) => p.category === filters.category);
    const ledger = await ledgerRowsTx(tx, {});
    const fin = await financialsFor(tx, rows, ledger);
    const projectsOut = rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      category: p.category,
      clientType: p.clientType,
      clientName: p.clientName,
      ...fin.get(p.id)!,
    }));
    return {
      filters,
      projects: projectsOut,
      totals: sumFinancials(projectsOut),
      byClient: groupTotals(projectsOut, (p) => (p.clientType === "INTERNAL" ? "Internal (AGOD)" : (p.clientName ?? "Unnamed client")), (p) => p),
      byCategory: groupTotals(projectsOut, (p) => p.category, (p) => p),
    };
  });
}

/** Unpaid payout balances by age since approval. */
export async function getPayoutAging(actor: Actor) {
  assertCan(actor, "finance.view");
  const today = todayInOperatingZone();
  return withActor(actor, async (tx) => {
    const ledger = (await ledgerRowsTx(tx, {})).filter((l) => l.status !== "VOIDED" && l.remainingMinor > 0);
    const items = ledger.map((l) => ({ remainingMinor: l.remainingMinor, approvedOn: l.approvedAt.toISOString().slice(0, 10) }));
    return {
      today,
      buckets: agePayouts(items, today),
      oldest: ledger
        .map((l) => ({ id: l.id, projectCode: l.projectCode, memberName: l.memberName, remainingMinor: l.remainingMinor, approvedAt: l.approvedAt }))
        .sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime())
        .slice(0, 10),
    };
  });
}

/** Expected contributor payouts over the next months. */
export async function getPayoutForecast(actor: Actor, months = 6) {
  assertCan(actor, "finance.view");
  const today = todayInOperatingZone();
  const currentMonth = today.slice(0, 7);
  return withActor(actor, async (tx) => {
    const items: ForecastItem[] = [];
    const ledger = (await ledgerRowsTx(tx, {})).filter((l) => l.status !== "VOIDED");
    const owed = ledger.reduce((s, l) => s + l.remainingMinor, 0);
    if (owed > 0) items.push({ month: currentMonth, kind: "OWED_NOW", amountMinor: owed });
    const open = await tx
      .select()
      .from(projects)
      .where(inArray(projects.status, ["DRAFT", "PLANNING", "IN_PROGRESS", "CHANGES_REQUESTED", "PENDING_APPROVAL"]));
    const pipeline = [];
    for (const p of open) {
      const planned = (await previewCompensationTx(tx, p)).allocatedMinor;
      if (planned <= 0) continue;
      const pending = p.status === "PENDING_APPROVAL";
      const month = pending || !p.targetDate ? currentMonth : p.targetDate.slice(0, 7);
      items.push({ month, kind: pending ? "PENDING_APPROVAL" : "IN_PROGRESS", amountMinor: planned });
      pipeline.push({ id: p.id, code: p.code, name: p.name, status: p.status, targetDate: p.targetDate, plannedPayoutMinor: planned, month });
    }
    return { currentMonth, ...forecastByMonth(items, currentMonth, months), owedNowMinor: owed, pipeline: pipeline.sort((a, b) => a.month.localeCompare(b.month)) };
  });
}

/** Team utilisation for a calendar month: estimated hours of tasks completed vs capacity. */
export async function getUtilisation(actor: Actor, rawMonth?: string) {
  assertCan(actor, "finance.view");
  const month = rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : todayInOperatingZone().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const weeks = (end.getTime() - start.getTime()) / (7 * 86_400_000);
  return withActor(actor, async (tx) => {
    const people = await tx
      .select({ id: orgMembers.id, name: orgMembers.name, weeklyCapacityHours: orgMembers.weeklyCapacityHours })
      .from(orgMembers)
      .where(eq(orgMembers.active, true))
      .orderBy(asc(orgMembers.name));
    const done = await tx
      .select({ assignedTo: tasks.assignedTo, estimateHours: tasks.estimateHours })
      .from(tasks)
      .where(and(eq(tasks.status, "DONE"), gte(tasks.completedAt, start), lt(tasks.completedAt, end)));
    const rows = people.map((p) => {
      const mine = done.filter((t) => t.assignedTo === p.id);
      const hours = mine.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
      return {
        ...p,
        tasksCompleted: mine.length,
        unestimated: mine.filter((t) => t.estimateHours === null).length,
        completedHours: hours,
        capacityHours: Math.round(p.weeklyCapacityHours * weeks),
        utilisationPct: utilisationPct(hours, p.weeklyCapacityHours, weeks),
      };
    });
    return { month, weeks: Math.round(weeks * 10) / 10, rows: rows.sort((a, b) => (b.utilisationPct ?? -1) - (a.utilisationPct ?? -1)) };
  });
}
