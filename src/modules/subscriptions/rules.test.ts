import { describe, expect, it } from "vitest";
import { canTransitionSubscription, diffTerms, monthlyValueMinor, renewalState } from "./rules";

const live = { status: "ACTIVE" as const, renewalDate: null, endDate: null, noticePeriodDays: 30 };

describe("subscription status changes", () => {
  it("follows draft → active ⇄ paused → ended/cancelled; ended and cancelled are final", () => {
    expect(canTransitionSubscription("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransitionSubscription("DRAFT", "PAUSED")).toBe(false);
    expect(canTransitionSubscription("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransitionSubscription("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransitionSubscription("ACTIVE", "DRAFT")).toBe(false);
    expect(canTransitionSubscription("ENDED", "ACTIVE")).toBe(false);
    expect(canTransitionSubscription("CANCELLED", "ACTIVE")).toBe(false);
  });
});

describe("monthly value", () => {
  it("spreads quarterly and annual prices over months, times quantity", () => {
    expect(monthlyValueMinor({ billingCadence: "MONTHLY", priceMinor: 50_000, quantity: 2 })).toBe(100_000);
    expect(monthlyValueMinor({ billingCadence: "QUARTERLY", priceMinor: 100_000, quantity: 1 })).toBe(33_333);
    expect(monthlyValueMinor({ billingCadence: "ANNUAL", priceMinor: 1_200_000, quantity: 1 })).toBe(100_000);
    expect(monthlyValueMinor({ billingCadence: "ONE_TIME", priceMinor: 1_000, quantity: 1 })).toBeNull();
    expect(monthlyValueMinor({ billingCadence: "CUSTOM", priceMinor: 1_000, quantity: 1 })).toBeNull();
  });
});

describe("renewal timing", () => {
  const today = "2026-10-05";
  it("is due within the notice period and overdue after the date", () => {
    expect(renewalState({ ...live, renewalDate: "2026-11-30" }, today)).toBeNull();
    expect(renewalState({ ...live, renewalDate: "2026-11-04" }, today)).toEqual({ kind: "DUE", date: "2026-11-04", days: 30 });
    expect(renewalState({ ...live, renewalDate: "2026-10-01" }, today)).toEqual({ kind: "OVERDUE", date: "2026-10-01", days: -4 });
  });
  it("falls back to the end date and flags a live subscription past its end", () => {
    expect(renewalState({ ...live, endDate: "2026-10-20" }, today)?.kind).toBe("DUE");
    expect(renewalState({ ...live, endDate: "2026-09-30", renewalDate: null }, today)?.kind).toBe("PAST_END");
  });
  it("ignores drafts and finished subscriptions", () => {
    expect(renewalState({ ...live, status: "DRAFT", renewalDate: "2026-10-01" }, today)).toBeNull();
    expect(renewalState({ ...live, status: "ENDED", renewalDate: "2026-10-01" }, today)).toBeNull();
  });
});

describe("amendment diff", () => {
  it("lists only changed terms", () => {
    const before = { priceMinor: 100, quantity: 1, billingCadence: "MONTHLY", pricingBasis: "FIXED", endDate: null, renewalDate: "2027-01-01", noticePeriodDays: 30, paymentTerms: null };
    expect(diffTerms(before, { ...before, priceMinor: 120, paymentTerms: "Net 14" })).toEqual({
      priceMinor: { from: 100, to: 120 },
      paymentTerms: { from: null, to: "Net 14" },
    });
    expect(diffTerms(before, { ...before })).toEqual({});
  });
});
