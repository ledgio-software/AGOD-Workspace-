import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, services, subscriptionAmendments, subscriptions } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import { archiveCustomer, createCustomer } from "@/modules/customers";
import {
  amendSubscription,
  changeSubscriptionStatus,
  createService,
  createSubscription,
  getSubscription,
  listServices,
  listSubscriptions,
  recurringTotals,
  setServiceActive,
  updateDraftSubscription,
  updateService,
  updateSubscriptionDetails,
} from "@/modules/subscriptions";
import { type Actor } from "@/lib/permissions";
import { createUser, db, expectDbError } from "./fixtures";

const code = () => `SVC-${randomUUID().slice(0, 8)}`;

async function setup() {
  const pm = await createUser("PROJECT_MANAGER");
  const customer = await createCustomer(pm, { name: `Customer ${randomUUID().slice(0, 8)}`, type: "COMPANY", status: "ACTIVE", ownerId: pm.id });
  const service = await createService(pm, { code: code(), name: "Managed hosting", defaultCadence: "MONTHLY", defaultPrice: "450.00" });
  return { pm, customer, service };
}

const terms = (overrides: Record<string, unknown> = {}) => ({
  billingCadence: "MONTHLY" as const,
  price: "450.00",
  pricingBasis: "FIXED" as const,
  quantity: 1,
  noticePeriodDays: 30,
  ...overrides,
});

async function subscribe(pm: Actor, customerId: string, serviceId: string, overrides: Record<string, unknown> = {}) {
  return createSubscription(pm, {
    customerId,
    serviceId,
    startDate: "2026-01-01",
    ownerId: pm.id,
    activate: true,
    ...terms(),
    ...overrides,
  });
}

describe("service catalogue", () => {
  it("is for managers only; codes are unique (case ignored); retired services take no new subscriptions", async () => {
    const { pm, customer, service } = await setup();
    const member = await createUser("TEAM_MEMBER");
    await expect(listServices(member)).rejects.toThrow(PermissionError);
    expect(await withActor(member, (tx) => tx.select().from(services))).toHaveLength(0);

    await expect(createService(pm, { code: service.code.toLowerCase(), name: "Copy", defaultCadence: "ANNUAL" })).rejects.toThrow(/already exists/);
    expect(service.defaultPriceMinor).toBe(45_000);

    await setServiceActive(pm, service.id, false);
    await expect(subscribe(pm, customer.id, service.id)).rejects.toThrow(/retired/);
  });

  it("renaming a service doesn't change existing subscriptions", async () => {
    const { pm, customer, service } = await setup();
    const sub = await subscribe(pm, customer.id, service.id);
    await updateService(pm, service.id, { code: service.code, name: "Premium hosting", defaultCadence: "MONTHLY", defaultPrice: "600", version: service.version });
    const [reloaded] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(reloaded.serviceName).toBe("Managed hosting");
    expect(reloaded.priceMinor).toBe(45_000);
  });
});

describe("subscriptions", () => {
  it("validates dates and owners, and members can't see them", async () => {
    const { pm, customer, service } = await setup();
    const member = await createUser("TEAM_MEMBER");
    await expect(subscribe(pm, customer.id, service.id, { endDate: "2025-12-31" })).rejects.toThrow(/end date/);
    await expect(subscribe(pm, customer.id, service.id, { endDate: "2026-06-30", renewalDate: "2026-07-31" })).rejects.toThrow(/renewal date/);
    await expect(subscribe(pm, customer.id, service.id, { ownerId: member.id })).rejects.toThrow(/Project Manager or Admin/);
    await expect(subscribe(pm, customer.id, service.id, { price: "4.505" })).rejects.toThrow(/GHS/);

    const sub = await subscribe(pm, customer.id, service.id, { renewalDate: "2026-12-01", endDate: "2026-12-31" });
    expect(sub.status).toBe("ACTIVE");
    expect(await withActor(member, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))).toHaveLength(0);
    await expect(listSubscriptions(member)).rejects.toThrow(PermissionError);
    // The database checks the dates too.
    await expectDbError(db.update(subscriptions).set({ endDate: "2025-01-01" }).where(eq(subscriptions.id, sub.id)), /subscriptions_end_after_start/);
  });

  it("drafts are edited freely; live subscriptions change terms only through amendments", async () => {
    const { pm, customer, service } = await setup();
    const draft = await subscribe(pm, customer.id, service.id, { activate: false });
    expect(draft.status).toBe("DRAFT");
    const edited = await updateDraftSubscription(pm, draft.id, {
      startDate: "2026-02-01",
      ownerId: pm.id,
      ...terms({ price: "400" }),
      version: draft.version,
    });
    expect(edited.priceMinor).toBe(40_000);
    await expect(
      amendSubscription(pm, draft.id, { ...terms(), effectiveDate: "2026-03-01", reason: "Too early", version: edited.version }),
    ).rejects.toThrow(/Edit the draft/);

    await changeSubscriptionStatus(pm, draft.id, { to: "ACTIVE", version: edited.version });
    const active = (await db.select().from(subscriptions).where(eq(subscriptions.id, draft.id)))[0];
    await expect(
      updateDraftSubscription(pm, draft.id, { startDate: "2026-02-01", ownerId: pm.id, ...terms(), version: active.version }),
    ).rejects.toThrow(/amendment/);

    await expect(
      amendSubscription(pm, draft.id, { ...terms({ price: "400" }), effectiveDate: "2026-03-01", reason: "Nothing", version: active.version }),
    ).rejects.toThrow(/Nothing changed/);
    const amended = await amendSubscription(pm, draft.id, {
      ...terms({ price: "480", quantity: 2, paymentTerms: "Net 14" }),
      effectiveDate: "2026-04-01",
      reason: "Second site added",
      version: active.version,
    });
    expect(amended.priceMinor).toBe(48_000);
    const [amendment] = await db.select().from(subscriptionAmendments).where(eq(subscriptionAmendments.subscriptionId, draft.id));
    expect(amendment.changes).toEqual({
      priceMinor: { from: 40_000, to: 48_000 },
      quantity: { from: 1, to: 2 },
      paymentTerms: { from: null, to: "Net 14" },
    });
    // Amendments are append-only.
    await expectDbError(db.update(subscriptionAmendments).set({ reason: "Edited" }).where(eq(subscriptionAmendments.id, amendment.id)), /cannot be changed/);
    await expectDbError(db.delete(subscriptions).where(eq(subscriptions.id, draft.id)), /cannot be deleted/);

    // Details (owners, notes) change without an amendment, and a stale version is refused.
    await updateSubscriptionDetails(pm, draft.id, { ownerId: pm.id, notes: "Call before invoicing", version: amended.version });
    await expect(updateSubscriptionDetails(pm, draft.id, { ownerId: pm.id, version: amended.version })).rejects.toThrow(/meanwhile/);

    const detail = await getSubscription(pm, draft.id);
    expect(detail?.amendments).toHaveLength(1);
    expect(detail?.monthlyValueMinor).toBe(96_000);
    expect(detail?.activity.map((a) => a.action)).toEqual(
      expect.arrayContaining(["subscription.created", "subscription.updated", "subscription.status_changed", "subscription.amended"]),
    );
  });

  it("pausing, ending and cancelling need a reason; ended subscriptions are final", async () => {
    const { pm, customer, service } = await setup();
    let sub = await subscribe(pm, customer.id, service.id);
    await expect(changeSubscriptionStatus(pm, sub.id, { to: "PAUSED", version: sub.version })).rejects.toThrow(/reason/);
    await changeSubscriptionStatus(pm, sub.id, { to: "PAUSED", reason: "Customer on holiday", version: sub.version });
    sub = (await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0];
    await expect(changeSubscriptionStatus(pm, sub.id, { to: "DRAFT", version: sub.version })).rejects.toThrow(/cannot move/);
    await changeSubscriptionStatus(pm, sub.id, { to: "ENDED", reason: "Contract finished", version: sub.version });
    sub = (await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0];
    expect(sub.endedAt).not.toBeNull();
    expect(sub.statusReason).toBe("Contract finished");
    await expect(changeSubscriptionStatus(pm, sub.id, { to: "ACTIVE", version: sub.version })).rejects.toThrow(/ended/);
    // The database refuses changes to a finished subscription even without the service.
    await expectDbError(db.update(subscriptions).set({ notes: "x" }).where(eq(subscriptions.id, sub.id)), /ended or cancelled/);
  });

  it("lists live subscriptions with monthly value and renewal timing; open subscriptions block archiving the customer", async () => {
    const { pm, customer, service } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await subscribe(pm, customer.id, service.id, { billingCadence: "ANNUAL", price: "1200", startDate: today, renewalDate: soon });
    const quiet = await subscribe(pm, customer.id, service.id, { startDate: today });
    await changeSubscriptionStatus(pm, quiet.id, { to: "PAUSED", reason: "On hold", version: quiet.version });

    const rows = await listSubscriptions(pm, { customerId: customer.id });
    expect(rows).toHaveLength(2);
    expect(recurringTotals(rows)).toEqual([{ currency: "GHS", monthlyMinor: 10_000 }]); // paused ones don't count
    const attention = await listSubscriptions(pm, { customerId: customer.id, attention: true });
    expect(attention.map((r) => r.renewal?.kind)).toEqual(["DUE"]);

    await expect(archiveCustomer(pm, customer.id, { reason: "Gone" })).rejects.toThrow(/subscriptions first/);
  });

  it("another PM can read the subscription history", async () => {
    const { pm, customer, service } = await setup();
    const other = await createUser("PROJECT_MANAGER");
    const sub = await subscribe(pm, customer.id, service.id);
    const events = await withActor(other, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.entityId, sub.id)));
    expect(events.map((e) => e.action)).toContain("subscription.created");
  });
});
