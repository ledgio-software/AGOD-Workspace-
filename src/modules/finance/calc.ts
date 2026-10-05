// Pure profitability arithmetic (roadmap Stage 3). All amounts are integer minor units (pesewas);
// percentages are rounded to one decimal place for display only.

export type ProjectMoney = {
  /** External projects: the project value. Internal projects earn no revenue (they are a cost). */
  revenueMinor: number;
  /** Contributor payouts planned from the team splits (before approval) or committed (after). */
  plannedPayoutMinor: number;
  /** Approved payouts after adjustments, excluding voided ones; 0 before approval. */
  committedPayoutMinor: number;
  paidPayoutMinor: number;
  costBudgetMinor: number;
  /** Recorded, non-voided costs other than payouts. */
  actualCostMinor: number;
  approved: boolean;
};

export type ProjectFinancials = ProjectMoney & {
  estimatedProfitMinor: number;
  estimatedMarginPct: number | null;
  /** Revenue − committed (or, before approval, planned) payouts − recorded costs. */
  actualProfitMinor: number;
  actualMarginPct: number | null;
  /** Positive when recorded costs exceed the budget. */
  costOverBudgetMinor: number;
  outstandingPayoutMinor: number;
};

export const marginPct = (profitMinor: number, revenueMinor: number): number | null =>
  revenueMinor > 0 ? Math.round((profitMinor / revenueMinor) * 1000) / 10 : null;

export function projectFinancials(m: ProjectMoney): ProjectFinancials {
  const estimatedProfitMinor = m.revenueMinor - m.plannedPayoutMinor - m.costBudgetMinor;
  const payouts = m.approved ? m.committedPayoutMinor : m.plannedPayoutMinor;
  const actualProfitMinor = m.revenueMinor - payouts - m.actualCostMinor;
  return {
    ...m,
    estimatedProfitMinor,
    estimatedMarginPct: marginPct(estimatedProfitMinor, m.revenueMinor),
    actualProfitMinor,
    actualMarginPct: marginPct(actualProfitMinor, m.revenueMinor),
    costOverBudgetMinor: m.actualCostMinor - m.costBudgetMinor,
    outstandingPayoutMinor: Math.max(0, m.committedPayoutMinor - m.paidPayoutMinor),
  };
}

export type Totals = { revenueMinor: number; payoutMinor: number; costMinor: number; profitMinor: number; marginPct: number | null; projects: number };

/** Adds up projects by actual figures; used for overall totals and per-client / per-type groups. */
export function sumFinancials(rows: ProjectFinancials[]): Totals {
  const revenueMinor = rows.reduce((s, r) => s + r.revenueMinor, 0);
  const payoutMinor = rows.reduce((s, r) => s + (r.approved ? r.committedPayoutMinor : r.plannedPayoutMinor), 0);
  const costMinor = rows.reduce((s, r) => s + r.actualCostMinor, 0);
  const profitMinor = revenueMinor - payoutMinor - costMinor;
  return { revenueMinor, payoutMinor, costMinor, profitMinor, marginPct: marginPct(profitMinor, revenueMinor), projects: rows.length };
}

export function groupTotals<T>(rows: T[], key: (r: T) => string, fin: (r: T) => ProjectFinancials) {
  const groups = new Map<string, ProjectFinancials[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), fin(r)]);
  return [...groups.entries()].map(([name, list]) => ({ name, ...sumFinancials(list) })).sort((a, b) => b.revenueMinor - a.revenueMinor);
}

export const AGING_BUCKETS = [
  { label: "0–30 days", min: 0, max: 30 },
  { label: "31–60 days", min: 31, max: 60 },
  { label: "61–90 days", min: 61, max: 90 },
  { label: "Over 90 days", min: 91, max: Infinity },
] as const;

/** Outstanding payout balances grouped by days since approval. */
export function agePayouts(items: { remainingMinor: number; approvedOn: string }[], today: string) {
  const days = (d: string) => Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
  return AGING_BUCKETS.map((b) => {
    const inBucket = items.filter((i) => i.remainingMinor > 0 && days(i.approvedOn) >= b.min && days(i.approvedOn) <= b.max);
    return { label: b.label, count: inBucket.length, remainingMinor: inBucket.reduce((s, i) => s + i.remainingMinor, 0) };
  });
}

export type ForecastItem = { month: string; kind: "OWED_NOW" | "PENDING_APPROVAL" | "IN_PROGRESS"; amountMinor: number };

/**
 * Monthly payout forecast: what is owed now falls in the current month; projects awaiting approval
 * also in the current month; projects in progress in the month of their target date (or the
 * current month when it has passed or is not set).
 */
export function forecastByMonth(items: ForecastItem[], currentMonth: string, months = 6) {
  const list: string[] = [];
  let [y, m] = currentMonth.split("-").map(Number);
  for (let i = 0; i < months; i++) {
    list.push(`${y}-${String(m).padStart(2, "0")}`);
    if (m === 12) {
      y += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
  const last = list.at(-1)!;
  const rows = list.map((month) => ({ month, owedNowMinor: 0, pendingApprovalMinor: 0, inProgressMinor: 0, totalMinor: 0 }));
  let laterMinor = 0;
  for (const it of items) {
    const month = it.month < currentMonth ? currentMonth : it.month;
    if (month > last) {
      laterMinor += it.amountMinor;
      continue;
    }
    const row = rows.find((r) => r.month === month)!;
    if (it.kind === "OWED_NOW") row.owedNowMinor += it.amountMinor;
    else if (it.kind === "PENDING_APPROVAL") row.pendingApprovalMinor += it.amountMinor;
    else row.inProgressMinor += it.amountMinor;
    row.totalMinor += it.amountMinor;
  }
  return { rows, laterMinor };
}

/** Utilisation: estimated hours of work completed in a month against capacity for that month. */
export function utilisationPct(completedHours: number, weeklyCapacityHours: number, weeksInMonth: number): number | null {
  const capacity = weeklyCapacityHours * weeksInMonth;
  return capacity > 0 ? Math.round((completedHours / capacity) * 100) : null;
}
