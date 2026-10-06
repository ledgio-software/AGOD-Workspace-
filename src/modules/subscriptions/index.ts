import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { auditEvents, customers, notifications, services, subscriptionAmendments, subscriptions, users } from "@/lib/db/schema";
import { todayInOperatingZone } from "@/lib/dates";
import { DEFAULT_CURRENCY, parseMoney } from "@/lib/money";
import { addDays } from "@/modules/notifications/deadlines";
import { type Actor, assertCan, can } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { isUniqueViolation } from "@/modules/db-errors";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import {
  type RenewalState,
  type SubscriptionStatus,
  canTransitionSubscription,
  diffTerms,
  isLive,
  monthlyValueMinor,
  renewalAlerts,
  renewalState,
  suggestRenewal,
  transitionNeedsReason,
} from "./rules";

// Phase 17: the service catalogue (what AGOD sells) and customer subscriptions (what each customer
// has agreed to). PMs and Admins only. A subscription keeps its own negotiated terms; once live,
// commercial terms change only through an amendment that records old and new values.

export const BILLING_CADENCES = ["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"] as const;
export const PRICING_BASES = ["FIXED", "PER_SEAT", "USAGE", "OTHER"] as const;
export const SUBSCRIPTION_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ENDED", "CANCELLED"] as const;

type ServiceRow = typeof services.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.iso.date("Use a valid date").nullable())
  .nullish();
const requiredMoney = (label: string) =>
  z.string().transform((v, ctx) => {
    const minor = parseMoney(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: `Enter the ${label} in GHS, e.g. 450.00` });
      return z.NEVER;
    }
    return minor;
  });
const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(1000);

function guarded<T>(duplicateMessage: string, run: () => Promise<T>): Promise<T> {
  return run().catch((error: unknown) => {
    if (isUniqueViolation(error)) throw new ServiceError(duplicateMessage);
    rethrowDbGuard(error);
  });
}

// ---------------------------------------------------------------------------------------------
// Service catalogue

export const serviceInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, "Use a short code of 2–30 letters, digits, - or _, e.g. HOSTING-STD"),
  name: z.string().trim().min(2, "Service name is required").max(200),
  description: optionalText(2000),
  defaultCadence: z.enum(BILLING_CADENCES),
  // Optional: a starting price copied into new subscriptions, which can then be negotiated.
  defaultPrice: z
    .string()
    .nullish()
    .transform((v, ctx) => {
      if (!v || v.trim() === "") return null;
      const minor = parseMoney(v);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: "Enter the default price in GHS, e.g. 450.00, or leave it empty" });
        return z.NEVER;
      }
      return minor;
    }),
});

function auditableService(s: ServiceRow) {
  return {
    code: s.code,
    name: s.name,
    description: s.description,
    defaultCadence: s.defaultCadence,
    defaultPriceMinor: s.defaultPriceMinor,
    currency: s.currency,
    active: s.active,
  };
}

export async function listServices(actor: Actor) {
  assertCan(actor, "subscription.view");
  return withActor(actor, async (tx) => {
    const rows = await tx.select().from(services).orderBy(desc(services.active), asc(services.name));
    const counts = await tx
      .select({ serviceId: subscriptions.serviceId, live: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ["ACTIVE", "PAUSED"]))
      .groupBy(subscriptions.serviceId);
    return rows.map((s) => ({ ...s, liveSubscriptions: counts.find((c) => c.serviceId === s.id)?.live ?? 0 }));
  });
}

export async function createService(actor: Actor, raw: z.input<typeof serviceInput>, request?: RequestMeta) {
  assertCan(actor, "subscription.manage");
  const input = serviceInput.parse(raw);
  return withActor(actor, async (tx) => {
    const [created] = await guarded(`A service with code ${input.code} already exists.`, () =>
      tx
        .insert(services)
        .values({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          defaultCadence: input.defaultCadence,
          defaultPriceMinor: input.defaultPrice,
          currency: DEFAULT_CURRENCY,
          createdBy: actor.id,
        })
        .returning(),
    );
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "service",
      entityId: created.id,
      action: "service.created",
      after: auditableService(created),
      request,
    });
    return created;
  });
}

async function lockService(tx: Tx, serviceId: string) {
  const [service] = await tx.select().from(services).where(eq(services.id, serviceId)).for("update");
  if (!service) throw new ServiceError("Service not found.");
  return service;
}

/** Catalogue changes never touch existing subscriptions: they keep their own name and price. */
export async function updateService(
  actor: Actor,
  serviceId: string,
  raw: z.input<typeof serviceInput> & { version: number | string },
  request?: RequestMeta,
) {
  assertCan(actor, "subscription.manage");
  const input = serviceInput.parse(raw);
  return withActor(actor, async (tx) => {
    const service = await lockService(tx, serviceId);
    if (service.version !== Number(raw.version)) {
      throw new ServiceError("Someone else changed this service meanwhile. Reload the page and try again.");
    }
    const [updated] = await guarded(`A service with code ${input.code} already exists.`, () =>
      tx
        .update(services)
        .set({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          defaultCadence: input.defaultCadence,
          defaultPriceMinor: input.defaultPrice,
          version: service.version + 1,
        })
        .where(eq(services.id, serviceId))
        .returning(),
    );
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "service",
      entityId: serviceId,
      action: "service.updated",
      before: auditableService(service),
      after: auditableService(updated),
      request,
    });
    return updated;
  });
}

export async function setServiceActive(actor: Actor, serviceId: string, active: boolean, request?: RequestMeta) {
  assertCan(actor, "subscription.manage");
  await withActor(actor, async (tx) => {
    const service = await lockService(tx, serviceId);
    if (service.active === active) throw new ServiceError(active ? "This service is already offered." : "This service is already retired.");
    await tx.update(services).set({ active, version: service.version + 1 }).where(eq(services.id, serviceId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "service",
      entityId: serviceId,
      action: active ? "service.reactivated" : "service.retired",
      before: { active: service.active },
      after: { active },
      request,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Subscriptions

const termsShape = {
  billingCadence: z.enum(BILLING_CADENCES),
  price: requiredMoney("price"),
  pricingBasis: z.enum(PRICING_BASES),
  quantity: z.coerce.number().int("Use a whole number").min(1, "At least 1").max(100_000),
  endDate: optionalDate,
  renewalDate: optionalDate,
  noticePeriodDays: z.coerce.number().int("Whole days").min(0, "0 to 365 days").max(365, "0 to 365 days"),
  paymentTerms: optionalText(200),
};

const detailsShape = {
  ownerId: z.uuid("Choose an owner"),
  renewalOwnerId: z
    .union([z.uuid(), z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  externalReference: optionalText(100),
  notes: optionalText(4000),
};

export const subscriptionInput = z.object({
  customerId: z.uuid("Choose a customer"),
  serviceId: z.uuid("Choose a service"),
  startDate: z.iso.date("Enter the start date"),
  ...termsShape,
  ...detailsShape,
  /** True: start as Active. False: save as a draft to finish later. */
  activate: z.boolean().default(false),
});

export const draftEditInput = z.object({ startDate: z.iso.date("Enter the start date"), ...termsShape, ...detailsShape });
export const detailsInput = z.object(detailsShape);
export const amendInput = z.object({ ...termsShape, effectiveDate: z.iso.date("Enter the date the change takes effect"), reason });
export const statusInput = z.object({ to: z.enum(SUBSCRIPTION_STATUSES), reason: optionalText(1000) });

type Terms = z.output<z.ZodObject<typeof termsShape>>;

function termsColumns(t: Terms) {
  return {
    billingCadence: t.billingCadence,
    priceMinor: t.price,
    pricingBasis: t.pricingBasis,
    quantity: t.quantity,
    endDate: t.endDate ?? null,
    renewalDate: t.renewalDate ?? null,
    noticePeriodDays: t.noticePeriodDays,
    paymentTerms: t.paymentTerms ?? null,
  };
}

/** Friendly messages for the date rules the database also enforces. */
function assertDates(startDate: string, t: { endDate?: string | null; renewalDate?: string | null }) {
  if (t.endDate && t.endDate < startDate) throw new ServiceError("The end date cannot be before the start date.");
  if (t.renewalDate && t.renewalDate < startDate) throw new ServiceError("The renewal date cannot be before the start date.");
  if (t.renewalDate && t.endDate && t.renewalDate > t.endDate) {
    throw new ServiceError("The renewal date must be on or before the end date.");
  }
}

async function assertOwner(tx: Tx, userId: string, what: string) {
  const [user] = await tx.select({ active: users.active, role: users.role }).from(users).where(eq(users.id, userId));
  if (!user) throw new ServiceError(`${what} not found.`);
  if (!user.active) throw new ServiceError(`${what} is inactive.`);
  if (user.role === "TEAM_MEMBER") throw new ServiceError(`${what} must be a Project Manager or Admin.`);
}

async function assertDetails(tx: Tx, d: { ownerId: string; renewalOwnerId?: string | null }, previous?: SubscriptionRow) {
  if (d.ownerId !== previous?.ownerId) await assertOwner(tx, d.ownerId, "The owner");
  if (d.renewalOwnerId && d.renewalOwnerId !== previous?.renewalOwnerId) await assertOwner(tx, d.renewalOwnerId, "The renewal owner");
}

async function assertCustomerOpen(tx: Tx, customerId: string) {
  const [customer] = await tx.select({ name: customers.name, status: customers.status }).from(customers).where(eq(customers.id, customerId));
  if (!customer) throw new ServiceError("Customer not found.");
  if (customer.status === "ARCHIVED") throw new ServiceError(`${customer.name} is archived. Restore it first.`);
}

function auditableSubscription(s: SubscriptionRow) {
  return {
    status: s.status,
    startDate: s.startDate,
    endDate: s.endDate,
    renewalDate: s.renewalDate,
    noticePeriodDays: s.noticePeriodDays,
    billingCadence: s.billingCadence,
    priceMinor: s.priceMinor,
    currency: s.currency,
    pricingBasis: s.pricingBasis,
    quantity: s.quantity,
    paymentTerms: s.paymentTerms,
    ownerId: s.ownerId,
    renewalOwnerId: s.renewalOwnerId,
    externalReference: s.externalReference,
    notes: s.notes,
  };
}

export async function createSubscription(actor: Actor, raw: z.input<typeof subscriptionInput>, request?: RequestMeta) {
  assertCan(actor, "subscription.manage");
  const input = subscriptionInput.parse(raw);
  assertDates(input.startDate, input);
  return withActor(actor, async (tx) => {
    await assertCustomerOpen(tx, input.customerId);
    const [service] = await tx.select().from(services).where(eq(services.id, input.serviceId));
    if (!service) throw new ServiceError("Service not found.");
    if (!service.active) throw new ServiceError(`${service.name} is retired and can't be used for new subscriptions.`);
    await assertDetails(tx, input);
    const status = input.activate ? "ACTIVE" : "DRAFT";
    const [created] = await tx
      .insert(subscriptions)
      .values({
        customerId: input.customerId,
        serviceId: service.id,
        serviceName: service.name,
        status,
        startDate: input.startDate,
        ...termsColumns(input),
        currency: service.currency,
        ownerId: input.ownerId,
        renewalOwnerId: input.renewalOwnerId ?? null,
        externalReference: input.externalReference ?? null,
        notes: input.notes ?? null,
        createdBy: actor.id,
      })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "subscription",
      entityId: created.id,
      action: "subscription.created",
      after: { ...auditableSubscription(created), customerId: created.customerId, service: created.serviceName },
      request,
    });
    return created;
  });
}

async function lockSubscription(tx: Tx, subscriptionId: string, version?: number | string) {
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).for("update");
  if (!sub) throw new ServiceError("Subscription not found.");
  if (sub.status === "ENDED" || sub.status === "CANCELLED") {
    throw new ServiceError("This subscription has ended. Create a new one instead.");
  }
  if (version !== undefined && sub.version !== Number(version)) {
    throw new ServiceError("Someone else changed this subscription meanwhile. Reload the page and try again.");
  }
  return sub;
}

/** Drafts are still being negotiated: every term can change without an amendment. */
export async function updateDraftSubscription(
  actor: Actor,
  subscriptionId: string,
  raw: z.input<typeof draftEditInput> & { version: number | string },
  request?: RequestMeta,
) {
  assertCan(actor, "subscription.manage");
  const input = draftEditInput.parse(raw);
  assertDates(input.startDate, input);
  return withActor(actor, async (tx) => {
    const sub = await lockSubscription(tx, subscriptionId, raw.version);
    if (sub.status !== "DRAFT") throw new ServiceError("Only drafts can be edited freely. Record an amendment instead.");
    await assertDetails(tx, input, sub);
    const [updated] = await tx
      .update(subscriptions)
      .set({
        startDate: input.startDate,
        ...termsColumns(input),
        ownerId: input.ownerId,
        renewalOwnerId: input.renewalOwnerId ?? null,
        externalReference: input.externalReference ?? null,
        notes: input.notes ?? null,
        version: sub.version + 1,
      })
      .where(eq(subscriptions.id, subscriptionId))
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "subscription",
      entityId: subscriptionId,
      action: "subscription.updated",
      before: auditableSubscription(sub),
      after: auditableSubscription(updated),
      request,
    });
    return updated;
  });
}

/** Owners, reference and notes: not commercial terms, so no amendment needed. */
export async function updateSubscriptionDetails(
  actor: Actor,
  subscriptionId: string,
  raw: z.input<typeof detailsInput> & { version: number | string },
  request?: RequestMeta,
) {
  assertCan(actor, "subscription.manage");
  const input = detailsInput.parse(raw);
  return withActor(actor, async (tx) => {
    const sub = await lockSubscription(tx, subscriptionId, raw.version);
    await assertDetails(tx, input, sub);
    const [updated] = await tx
      .update(subscriptions)
      .set({
        ownerId: input.ownerId,
        renewalOwnerId: input.renewalOwnerId ?? null,
        externalReference: input.externalReference ?? null,
        notes: input.notes ?? null,
        version: sub.version + 1,
      })
      .where(eq(subscriptions.id, subscriptionId))
      .returning();
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "subscription",
      entityId: subscriptionId,
      action: "subscription.updated",
      before: auditableSubscription(sub),
      after: auditableSubscription(updated),
      request,
    });
    return updated;
  });
}

/** Changes the commercial terms of a live subscription, keeping the old values in an amendment. */
export async function amendSubscription(
  actor: Actor,
  subscriptionId: string,
  raw: z.input<typeof amendInput> & { version: number | string },
  request?: RequestMeta,
) {
  assertCan(actor, "subscription.manage");
  const input = amendInput.parse(raw);
  return withActor(actor, async (tx) => {
    const sub = await lockSubscription(tx, subscriptionId, raw.version);
    return changeTerms(tx, actor, sub, termsColumns(input), input.effectiveDate, input.reason, "AMENDMENT", request);
  });
}

async function changeTerms(
  tx: Tx,
  actor: Actor,
  sub: SubscriptionRow,
  next: ReturnType<typeof termsColumns>,
  effectiveDate: string,
  reason: string,
  kind: "AMENDMENT" | "RENEWAL",
  request?: RequestMeta,
) {
  if (!isLive(sub.status)) throw new ServiceError("Only active or paused subscriptions are amended. Edit the draft instead.");
  if (effectiveDate < sub.startDate) throw new ServiceError("The change cannot take effect before the subscription starts.");
  assertDates(sub.startDate, next);
  const changes = diffTerms(sub, next);
  if (Object.keys(changes).length === 0) throw new ServiceError("Nothing changed: adjust at least one term.");
  await tx.insert(subscriptionAmendments).values({
    subscriptionId: sub.id,
    kind,
    effectiveDate,
    changes,
    reason,
    createdBy: actor.id,
  });
  const [updated] = await tx
    .update(subscriptions)
    .set({ ...next, version: sub.version + 1 })
    .where(eq(subscriptions.id, sub.id))
    .returning()
    .catch(rethrowDbGuard);
  await recordAudit(tx, {
    actorId: actor.id,
    entityType: "subscription",
    entityId: sub.id,
    action: kind === "RENEWAL" ? "subscription.renewed" : "subscription.amended",
    before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])),
    after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
    reason: `${reason} (effective ${effectiveDate})`,
    request,
  });
  return updated;
}

export const renewInput = z.object({
  renewalDate: z.iso.date("Enter the next renewal date"),
  endDate: optionalDate,
  price: requiredMoney("price"),
  reason: z.string().trim().min(3, "Say what was agreed (at least 3 characters)").max(1000),
});

/**
 * Records a renewal decision: the renewal date (and end date) move forward, optionally at a new
 * price. Kept as an amendment marked "renewal", so the previous terms stay visible. Sending a
 * reminder never renews anything by itself.
 */
export async function renewSubscription(
  actor: Actor,
  subscriptionId: string,
  raw: z.input<typeof renewInput> & { version: number | string },
  request?: RequestMeta,
) {
  assertCan(actor, "subscription.manage");
  const input = renewInput.parse(raw);
  return withActor(actor, async (tx) => {
    const sub = await lockSubscription(tx, subscriptionId, raw.version);
    const current = sub.renewalDate ?? sub.endDate;
    if (current && input.renewalDate <= current) {
      throw new ServiceError("The new renewal date must be after the current one.");
    }
    const next = {
      billingCadence: sub.billingCadence,
      priceMinor: input.price,
      pricingBasis: sub.pricingBasis,
      quantity: sub.quantity,
      endDate: input.endDate ?? null,
      renewalDate: input.renewalDate,
      noticePeriodDays: sub.noticePeriodDays,
      paymentTerms: sub.paymentTerms,
    };
    return changeTerms(tx, actor, sub, next, current ?? todayInOperatingZone(), input.reason, "RENEWAL", request);
  });
}

/** Suggested renewal terms for the Renew form. */
export function renewalSuggestion(s: Pick<SubscriptionRow, "billingCadence" | "renewalDate" | "endDate">) {
  return suggestRenewal(s, todayInOperatingZone());
}

export async function changeSubscriptionStatus(
  actor: Actor,
  subscriptionId: string,
  raw: z.input<typeof statusInput> & { version: number | string },
  request?: RequestMeta,
) {
  assertCan(actor, "subscription.manage");
  const input = statusInput.parse(raw);
  if (transitionNeedsReason(input.to) && (!input.reason || input.reason.length < 3)) {
    throw new ServiceError("Give a reason (at least 3 characters).");
  }
  await withActor(actor, async (tx) => {
    const sub = await lockSubscription(tx, subscriptionId, raw.version);
    if (!canTransitionSubscription(sub.status, input.to)) {
      throw new ServiceError(`A subscription cannot move from ${sub.status.toLowerCase()} to ${input.to.toLowerCase()}.`);
    }
    if (sub.status === "DRAFT" && input.to === "ACTIVE") await assertCustomerOpen(tx, sub.customerId);
    const finished = input.to === "ENDED" || input.to === "CANCELLED";
    await tx
      .update(subscriptions)
      .set({
        status: input.to,
        statusReason: transitionNeedsReason(input.to) ? (input.reason ?? null) : null,
        endedAt: finished ? new Date() : null,
        version: sub.version + 1,
      })
      .where(eq(subscriptions.id, subscriptionId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "subscription",
      entityId: subscriptionId,
      action: "subscription.status_changed",
      before: { status: sub.status },
      after: { status: input.to },
      reason: input.reason ?? null,
      request,
    });
  });
}

export const subscriptionFilters = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...SUBSCRIPTION_STATUSES, "LIVE", "ALL"]).optional().catch(undefined),
  /** Only subscriptions that need a renewal decision now. */
  attention: z.boolean().optional(),
  customerId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  /** Live subscriptions whose next renewal (or end) date is within this many days, or already past. */
  within: z.coerce.number().int().min(1).max(366).optional().catch(undefined),
});

export type SubscriptionSummary = {
  id: string;
  customerId: string;
  customerName: string;
  serviceName: string;
  status: SubscriptionStatus;
  startDate: string;
  endDate: string | null;
  renewalDate: string | null;
  billingCadence: SubscriptionRow["billingCadence"];
  priceMinor: number;
  quantity: number;
  currency: string;
  monthlyValueMinor: number | null;
  ownerName: string;
  renewal: RenewalState;
};

export async function listSubscriptions(actor: Actor, raw: z.input<typeof subscriptionFilters> = {}): Promise<SubscriptionSummary[]> {
  assertCan(actor, "subscription.view");
  const filters = subscriptionFilters.parse(raw);
  const today = todayInOperatingZone();
  return withActor(actor, async (tx) => {
    const conditions = [];
    const status = filters.status ?? "LIVE";
    if (status === "LIVE") conditions.push(inArray(subscriptions.status, ["ACTIVE", "PAUSED"]));
    else if (status !== "ALL") conditions.push(eq(subscriptions.status, status));
    if (filters.customerId) conditions.push(eq(subscriptions.customerId, filters.customerId));
    if (filters.serviceId) conditions.push(eq(subscriptions.serviceId, filters.serviceId));
    if (filters.q) {
      const like = `%${filters.q.replace(/[%_\\]/g, "\\$&")}%`;
      conditions.push(or(ilike(customers.name, like), ilike(subscriptions.serviceName, like), ilike(subscriptions.externalReference, like)));
    }
    const rows = await tx
      .select({ s: subscriptions, customerName: customers.name, ownerName: users.name })
      .from(subscriptions)
      .innerJoin(customers, eq(customers.id, subscriptions.customerId))
      .innerJoin(users, eq(users.id, subscriptions.ownerId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(sql`coalesce(${subscriptions.renewalDate}, ${subscriptions.endDate})`), asc(customers.name));
    const out = rows.map(({ s, customerName, ownerName }) => ({
      id: s.id,
      customerId: s.customerId,
      customerName,
      serviceName: s.serviceName,
      status: s.status,
      startDate: s.startDate,
      endDate: s.endDate,
      renewalDate: s.renewalDate,
      billingCadence: s.billingCadence,
      priceMinor: s.priceMinor,
      quantity: s.quantity,
      currency: s.currency,
      monthlyValueMinor: monthlyValueMinor(s),
      ownerName,
      renewal: renewalState(s, today),
    }));
    let result = filters.attention ? out.filter((s) => s.renewal) : out;
    if (filters.within) {
      const limit = addDays(today, filters.within);
      result = result.filter((s) => {
        const next = s.renewalDate ?? s.endDate;
        return isLive(s.status) && next !== null && next <= limit;
      });
    }
    return result;
  });
}

/** Monthly recurring value of live subscriptions by currency (paused ones don't count). */
export function recurringTotals(rows: SubscriptionSummary[]) {
  const totals = new Map<string, number>();
  for (const s of rows) {
    if (s.status !== "ACTIVE" || s.monthlyValueMinor === null) continue;
    totals.set(s.currency, (totals.get(s.currency) ?? 0) + s.monthlyValueMinor);
  }
  return [...totals].map(([currency, monthlyMinor]) => ({ currency, monthlyMinor }));
}

export async function getSubscription(actor: Actor, subscriptionId: string) {
  assertCan(actor, "subscription.view");
  if (!z.uuid().safeParse(subscriptionId).success) return null;
  const renewalOwner = alias(users, "renewal_owner");
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ s: subscriptions, customerName: customers.name, customerStatus: customers.status, ownerName: users.name, renewalOwnerName: renewalOwner.name })
      .from(subscriptions)
      .innerJoin(customers, eq(customers.id, subscriptions.customerId))
      .innerJoin(users, eq(users.id, subscriptions.ownerId))
      .leftJoin(renewalOwner, eq(renewalOwner.id, subscriptions.renewalOwnerId))
      .where(eq(subscriptions.id, subscriptionId));
    if (!row) return null;
    const amendments = await tx
      .select({ a: subscriptionAmendments, actorName: users.name })
      .from(subscriptionAmendments)
      .innerJoin(users, eq(users.id, subscriptionAmendments.createdBy))
      .where(eq(subscriptionAmendments.subscriptionId, subscriptionId))
      .orderBy(desc(subscriptionAmendments.createdAt));
    const activity = await tx
      .select({ event: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(and(eq(auditEvents.entityType, "subscription"), eq(auditEvents.entityId, subscriptionId)))
      .orderBy(desc(auditEvents.createdAt))
      .limit(50);
    const s = row.s;
    return {
      subscription: s,
      customerName: row.customerName,
      customerArchived: row.customerStatus === "ARCHIVED",
      ownerName: row.ownerName,
      renewalOwnerName: row.renewalOwnerName,
      monthlyValueMinor: monthlyValueMinor(s),
      renewal: renewalState(s, todayInOperatingZone()),
      amendments: amendments.map((a) => ({ ...a.a, actorName: a.actorName })),
      activity: activity.map((a) => ({ ...a.event, actorName: a.actorName })),
    };
  });
}

/** Services that can be chosen for a new subscription. */
export async function listServiceOptions(actor: Actor) {
  assertCan(actor, "subscription.view");
  return withActor(actor, (tx) =>
    tx
      .select({
        id: services.id,
        code: services.code,
        name: services.name,
        defaultCadence: services.defaultCadence,
        defaultPriceMinor: services.defaultPriceMinor,
      })
      .from(services)
      .where(eq(services.active, true))
      .orderBy(asc(services.name)),
  );
}

/** Used by the customers module: live or draft subscriptions block archiving a customer. */
export async function openSubscriptionCount(tx: Tx, customerId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(and(eq(subscriptions.customerId, customerId), inArray(subscriptions.status, ["DRAFT", "ACTIVE", "PAUSED"])));
  return row?.n ?? 0;
}

/**
 * Creates the renewal reminders the signed-in manager is missing (same approach as the task and
 * approval alerts: generated when they open the app, each sent once).
 */
export async function refreshRenewalAlerts(actor: Actor): Promise<number> {
  if (!can(actor, "subscription.view")) return 0;
  const today = todayInOperatingZone();
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: subscriptions.id,
        customerName: customers.name,
        serviceName: subscriptions.serviceName,
        status: subscriptions.status,
        renewalDate: subscriptions.renewalDate,
        endDate: subscriptions.endDate,
        noticePeriodDays: subscriptions.noticePeriodDays,
        ownerId: subscriptions.ownerId,
        renewalOwnerId: subscriptions.renewalOwnerId,
      })
      .from(subscriptions)
      .innerJoin(customers, eq(customers.id, subscriptions.customerId))
      .where(inArray(subscriptions.status, ["ACTIVE", "PAUSED"]));
    const alerts = renewalAlerts(actor.id, actor.role === "ADMIN", rows, today);
    if (alerts.length === 0) return 0;
    const inserted = await tx
      .insert(notifications)
      .values(
        alerts.map((a) => ({
          recipientId: a.recipientId,
          type: a.type,
          title: a.title,
          message: a.message,
          entityType: "subscription",
          entityId: a.subscriptionId,
          dedupeKey: a.dedupeKey,
        })),
      )
      .onConflictDoNothing({ target: [notifications.recipientId, notifications.dedupeKey], where: sql`${notifications.dedupeKey} IS NOT NULL` })
      .returning({ id: notifications.id });
    return inserted.length;
  });
}

export type RecurringGroup = { name: string; monthlyMinor: number; subscriptions: number };

/** Recurring revenue for Profitability: active subscriptions, monthly and annual, by service and customer. */
export async function getRecurringRevenue(actor: Actor) {
  assertCan(actor, "finance.view");
  if (!can(actor, "subscription.view")) return null;
  const live = await listSubscriptions(actor);
  const active = live.filter((s) => s.status === "ACTIVE" && s.monthlyValueMinor !== null);
  const group = (key: (s: SubscriptionSummary) => string): RecurringGroup[] => {
    const map = new Map<string, RecurringGroup>();
    for (const s of active) {
      const g = map.get(key(s)) ?? { name: key(s), monthlyMinor: 0, subscriptions: 0 };
      g.monthlyMinor += s.monthlyValueMinor ?? 0;
      g.subscriptions += 1;
      map.set(g.name, g);
    }
    return [...map.values()].sort((a, b) => b.monthlyMinor - a.monthlyMinor);
  };
  const today = todayInOperatingZone();
  const in90 = addDays(today, 90);
  const renewing = live.filter((s) => {
    const next = s.renewalDate ?? s.endDate;
    return next !== null && next <= in90;
  });
  return {
    totals: recurringTotals(live).map((t) => ({ ...t, annualMinor: t.monthlyMinor * 12 })),
    activeCount: active.length,
    byService: group((s) => s.serviceName),
    byCustomer: group((s) => s.customerName),
    renewingIn90Days: renewing.length,
    renewingMonthlyMinor: renewing.reduce((n, s) => n + (s.status === "ACTIVE" ? (s.monthlyValueMinor ?? 0) : 0), 0),
    needsAttention: live.filter((s) => s.renewal).length,
  };
}

/** For page loads: reminders are a convenience, so a failure is logged and never blocks the page. */
export async function refreshRenewalAlertsQuietly(actor: Actor): Promise<void> {
  try {
    await refreshRenewalAlerts(actor);
  } catch (error) {
    console.error("Renewal alerts failed", error instanceof Error ? error.message : error);
  }
}
