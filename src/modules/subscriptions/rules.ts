// Pure rules for subscriptions (Phase 17): status changes, recurring value and renewal timing.

export type SubscriptionStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED" | "CANCELLED";
export type BillingCadence = "ONE_TIME" | "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM";

const transitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "ENDED", "CANCELLED"],
  PAUSED: ["ACTIVE", "ENDED", "CANCELLED"],
  ENDED: [],
  CANCELLED: [],
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return transitions[from].includes(to);
}

export function allowedSubscriptionTransitions(from: SubscriptionStatus): SubscriptionStatus[] {
  return transitions[from];
}

/** Pausing, ending and cancelling need a written reason. */
export function transitionNeedsReason(to: SubscriptionStatus): boolean {
  return to === "PAUSED" || to === "ENDED" || to === "CANCELLED";
}

/** Live subscriptions: still being sold or delivered. */
export function isLive(status: SubscriptionStatus): boolean {
  return status === "ACTIVE" || status === "PAUSED";
}

/**
 * Monthly recurring value in minor units: price × quantity spread over a month. Null for one-time
 * and custom billing, which have no fixed monthly equivalent. Rounded to the nearest pesewa.
 */
export function monthlyValueMinor(s: { billingCadence: BillingCadence; priceMinor: number; quantity: number }): number | null {
  const total = s.priceMinor * s.quantity;
  switch (s.billingCadence) {
    case "MONTHLY":
      return total;
    case "QUARTERLY":
      return Math.round(total / 3);
    case "ANNUAL":
      return Math.round(total / 12);
    default:
      return null;
  }
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type RenewalState =
  | { kind: "PAST_END"; date: string; days: number }
  | { kind: "OVERDUE"; date: string; days: number }
  | { kind: "DUE"; date: string; days: number }
  | null;

/**
 * Whether an active or paused subscription needs a renewal decision now. The next date is the
 * renewal date, else the end date. "Due" starts the notice period before it; "overdue" once it has
 * passed. An end date in the past on a live subscription means it should be ended or amended.
 */
export function renewalState(
  s: { status: SubscriptionStatus; renewalDate: string | null; endDate: string | null; noticePeriodDays: number },
  today: string,
): RenewalState {
  if (!isLive(s.status)) return null;
  if (s.endDate && s.endDate < today) return { kind: "PAST_END", date: s.endDate, days: daysBetween(today, s.endDate) };
  const next = s.renewalDate ?? s.endDate;
  if (!next) return null;
  const days = daysBetween(today, next);
  if (days < 0) return { kind: "OVERDUE", date: next, days };
  if (days <= s.noticePeriodDays) return { kind: "DUE", date: next, days };
  return null;
}

/** Terms that, once a subscription is live, change only through an amendment. */
export const AMENDABLE_TERMS = [
  "priceMinor",
  "quantity",
  "billingCadence",
  "pricingBasis",
  "endDate",
  "renewalDate",
  "noticePeriodDays",
  "paymentTerms",
] as const;

export type AmendableTerm = (typeof AMENDABLE_TERMS)[number];
export type Terms = Record<AmendableTerm, unknown>;

/** The terms that differ between two versions, as { field: { from, to } }. */
export function diffTerms(before: Terms, after: Terms): Partial<Record<AmendableTerm, { from: unknown; to: unknown }>> {
  const changes: Partial<Record<AmendableTerm, { from: unknown; to: unknown }>> = {};
  for (const key of AMENDABLE_TERMS) {
    if ((before[key] ?? null) !== (after[key] ?? null)) changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return changes;
}
