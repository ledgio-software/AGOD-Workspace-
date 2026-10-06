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

/** Adds whole months to a calendar date, keeping the day where possible (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Months in one billing period; one-time and custom billing renew yearly by default. */
export function cadenceMonths(cadence: BillingCadence): number {
  return cadence === "MONTHLY" ? 1 : cadence === "QUARTERLY" ? 3 : 12;
}

/**
 * The suggested terms for a renewal: the renewal date (and end date, if any) move forward by one
 * billing period. Only a suggestion; the person renewing can change it.
 */
export function suggestRenewal(
  s: { billingCadence: BillingCadence; renewalDate: string | null; endDate: string | null },
  today: string,
): { renewalDate: string; endDate: string | null } {
  const months = cadenceMonths(s.billingCadence);
  const base = s.renewalDate ?? s.endDate ?? today;
  return { renewalDate: addMonths(base, months), endDate: s.endDate ? addMonths(s.endDate, months) : null };
}

/** Days a renewal may be overdue before Admins are told too. */
export const RENEWAL_ESCALATION_DAYS = 7;

export type RenewalAlert = {
  recipientId: string;
  type: "subscription.renewal_due" | "subscription.renewal_overdue" | "subscription.past_end" | "subscription.renewal_escalated";
  title: string;
  message: string;
  subscriptionId: string;
  dedupeKey: string;
};

type AlertSubscription = {
  id: string;
  customerName: string;
  serviceName: string;
  status: SubscriptionStatus;
  renewalDate: string | null;
  endDate: string | null;
  noticePeriodDays: number;
  ownerId: string;
  renewalOwnerId: string | null;
};

/**
 * Pure: renewal reminders for one user. The renewal owner (or the owner when none is set) is told
 * when the notice period starts, when the date passes, and when the end date passes; Admins are
 * told about anything a week overdue. Keys include the date, so a renewal (which moves the date)
 * starts a fresh cycle, and each alert is otherwise sent once.
 */
export function renewalAlerts(userId: string, isAdmin: boolean, subs: AlertSubscription[], today: string): RenewalAlert[] {
  const alerts: RenewalAlert[] = [];
  for (const s of subs) {
    const state = renewalState(s, today);
    if (!state) continue;
    const name = `${s.serviceName} for ${s.customerName}`;
    const responsible = s.renewalOwnerId ?? s.ownerId;
    if (responsible === userId) {
      if (state.kind === "DUE") {
        alerts.push({
          recipientId: userId,
          type: "subscription.renewal_due",
          title: `Renewal due: ${name}`,
          message: `Renews ${state.date} (${state.days === 0 ? "today" : `in ${state.days} days`}). Contact the customer and record the renewal, an amendment or the end.`,
          subscriptionId: s.id,
          dedupeKey: `subscription.renewal_due:${s.id}:${state.date}`,
        });
      } else if (state.kind === "OVERDUE") {
        alerts.push({
          recipientId: userId,
          type: "subscription.renewal_overdue",
          title: `Renewal overdue: ${name}`,
          message: `The renewal date ${state.date} has passed without a decision. Renew, amend or end it.`,
          subscriptionId: s.id,
          dedupeKey: `subscription.renewal_overdue:${s.id}:${state.date}`,
        });
      } else {
        alerts.push({
          recipientId: userId,
          type: "subscription.past_end",
          title: `Past its end date: ${name}`,
          message: `It ended ${state.date} but is still ${s.status.toLowerCase()}. Renew it or end it.`,
          subscriptionId: s.id,
          dedupeKey: `subscription.past_end:${s.id}:${state.date}`,
        });
      }
    } else if (isAdmin && state.kind !== "DUE" && -state.days >= RENEWAL_ESCALATION_DAYS) {
      alerts.push({
        recipientId: userId,
        type: "subscription.renewal_escalated",
        title: `Renewal ${-state.days} days overdue: ${name}`,
        message: `No decision since ${state.date}. Its renewal owner has been reminded.`,
        subscriptionId: s.id,
        dedupeKey: `subscription.renewal_escalated:${s.id}:${state.date}`,
      });
    }
  }
  return alerts;
}
