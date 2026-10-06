import { describe, expect, it } from "vitest";
import { addMonths, canTransitionSubscription, diffTerms, monthlyValueMinor, renewalAlerts, renewalState, suggestRenewal } from "./rules";

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

describe("renewal dates", () => {
  it("adds months and clamps to the end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-10-06", 12)).toBe("2027-10-06");
  });
  it("suggests the next period from the renewal date, moving the end date too", () => {
    expect(suggestRenewal({ billingCadence: "ANNUAL", renewalDate: "2026-12-01", endDate: "2026-12-31" }, "2026-10-06")).toEqual({
      renewalDate: "2027-12-01",
      endDate: "2027-12-31",
    });
    expect(suggestRenewal({ billingCadence: "QUARTERLY", renewalDate: null, endDate: null }, "2026-10-06")).toEqual({
      renewalDate: "2027-01-06",
      endDate: null,
    });
  });
});

describe("renewal reminders", () => {
  const today = "2026-10-06";
  const base = {
    id: "s1",
    customerName: "Northwind",
    serviceName: "Hosting",
    status: "ACTIVE" as const,
    endDate: null,
    noticePeriodDays: 30,
    ownerId: "owner",
    renewalOwnerId: null,
  };
  it("tells the renewal owner (or the owner) when due, overdue and past the end date", () => {
    expect(renewalAlerts("owner", false, [{ ...base, renewalDate: "2026-10-20" }], today).map((a) => [a.type, a.dedupeKey])).toEqual([
      ["subscription.renewal_due", "subscription.renewal_due:s1:2026-10-20"],
    ]);
    expect(renewalAlerts("owner", false, [{ ...base, renewalDate: "2026-10-01" }], today)[0].type).toBe("subscription.renewal_overdue");
    expect(renewalAlerts("owner", false, [{ ...base, renewalDate: null, endDate: "2026-09-30" }], today)[0].type).toBe("subscription.past_end");
    // A named renewal owner gets them instead of the owner.
    const delegated = { ...base, renewalOwnerId: "rep", renewalDate: "2026-10-20" };
    expect(renewalAlerts("owner", false, [delegated], today)).toEqual([]);
    expect(renewalAlerts("rep", false, [delegated], today)).toHaveLength(1);
    // Nothing outside the notice period or for finished subscriptions.
    expect(renewalAlerts("owner", false, [{ ...base, renewalDate: "2026-12-31" }], today)).toEqual([]);
    expect(renewalAlerts("owner", false, [{ ...base, status: "ENDED", renewalDate: "2026-10-01" }], today)).toEqual([]);
  });
  it("escalates to Admins after a week overdue", () => {
    expect(renewalAlerts("admin", true, [{ ...base, renewalDate: "2026-10-01" }], today)).toEqual([]); // 5 days
    const late = renewalAlerts("admin", true, [{ ...base, renewalDate: "2026-09-29" }], today);
    expect(late.map((a) => a.type)).toEqual(["subscription.renewal_escalated"]);
    expect(renewalAlerts("admin", true, [{ ...base, renewalDate: "2026-10-20" }], today)).toEqual([]); // due, not overdue
  });
});
