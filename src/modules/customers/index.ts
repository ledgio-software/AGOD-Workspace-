import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withActor } from "@/lib/db/actor";
import { auditEvents, customerContacts, customers, projects, users } from "@/lib/db/schema";
import { type Actor, assertCan } from "@/lib/permissions";
import { type RequestMeta, recordAudit } from "@/modules/audit";
import { isUniqueViolation } from "@/modules/db-errors";
import { ServiceError, rethrowDbGuard } from "@/modules/errors";
import { openSubscriptionCount } from "@/modules/subscriptions";

// Phase 16: customers (one record per client) and their contacts. PMs and Admins only; members
// see the client name copied onto their projects. Nothing is deleted: customers are archived,
// contacts deactivated.

export const CUSTOMER_TYPES = ["COMPANY", "PERSON", "PARTNER", "OTHER"] as const;
export const CUSTOMER_STATUSES = ["PROSPECT", "ACTIVE", "PAUSED", "CHURNED", "ARCHIVED"] as const;
/** Statuses a PM picks in the form; ARCHIVED is reached only by archiving. */
export const EDITABLE_CUSTOMER_STATUSES = ["PROSPECT", "ACTIVE", "PAUSED", "CHURNED"] as const;
export const CONTACT_CHANNELS = ["EMAIL", "PHONE", "WHATSAPP", "OTHER"] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
type CustomerRow = typeof customers.$inferSelect;
type ContactRow = typeof customerContacts.$inferSelect;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500);
const customerName = z.string().trim().min(2, "Customer name is required (at least 2 characters)").max(200);

export const customerInput = z.object({
  name: customerName,
  type: z.enum(CUSTOMER_TYPES),
  status: z.enum(EDITABLE_CUSTOMER_STATUSES),
  ownerId: z.uuid("Choose an account owner"),
  notes: optionalText(4000),
  externalReference: optionalText(100),
});

export const contactInput = z
  .object({
    name: z.string().trim().min(2, "Contact name is required").max(120),
    role: optionalText(120),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.email("Enter a valid email").nullable())
      .nullish(),
    phone: optionalText(40),
    preferredChannel: z.enum(CONTACT_CHANNELS),
    isPrimary: z.boolean().default(false),
    isBilling: z.boolean().default(false),
  })
  .refine((c) => !!c.email || !!c.phone, { message: "Give an email or a phone number for the contact." });

export const customerFilters = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional().catch(undefined),
});

function auditableCustomer(c: CustomerRow) {
  return {
    name: c.name,
    type: c.type,
    status: c.status,
    ownerId: c.ownerId,
    notes: c.notes,
    externalReference: c.externalReference,
  };
}

function auditableContact(c: ContactRow) {
  return {
    customerId: c.customerId,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    preferredChannel: c.preferredChannel,
    isPrimary: c.isPrimary,
    isBilling: c.isBilling,
    active: c.active,
  };
}

function duplicateName(name: string): ServiceError {
  return new ServiceError(`A customer named “${name}” already exists.`);
}

async function assertActiveOwner(tx: Tx, userId: string) {
  const [user] = await tx.select({ active: users.active, role: users.role }).from(users).where(eq(users.id, userId));
  if (!user) throw new ServiceError("The account owner was not found.");
  if (!user.active) throw new ServiceError("The account owner is inactive.");
  if (user.role === "TEAM_MEMBER") throw new ServiceError("The account owner must be a Project Manager or Admin.");
}

async function lockCustomer(tx: Tx, customerId: string): Promise<CustomerRow> {
  const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId)).for("update");
  if (!customer) throw new ServiceError("Customer not found.");
  return customer;
}

/** Inserts or updates, mapping a duplicate name to a readable error. */
async function guarded<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName(name);
    rethrowDbGuard(error);
  }
}

export type CustomerSummary = {
  id: string;
  name: string;
  type: CustomerRow["type"];
  status: CustomerStatus;
  ownerName: string;
  primaryContact: { name: string; email: string | null; phone: string | null } | null;
  projectCount: number;
  openProjectCount: number;
  /** Total value of linked projects that are not cancelled, by currency. */
  valueByCurrency: { currency: string; totalMinor: number }[];
  createdAt: Date;
};

export async function listCustomers(actor: Actor, raw: z.input<typeof customerFilters> = {}): Promise<CustomerSummary[]> {
  assertCan(actor, "customer.view");
  const filters = customerFilters.parse(raw);
  return withActor(actor, async (tx) => {
    const conditions = [];
    if (filters.status) conditions.push(eq(customers.status, filters.status));
    // Archived customers are hidden unless asked for.
    else conditions.push(ne(customers.status, "ARCHIVED"));
    if (filters.q) {
      const like = `%${filters.q.replace(/[%_\\]/g, "\\$&")}%`;
      conditions.push(or(ilike(customers.name, like), ilike(customers.externalReference, like)));
    }
    const rows = await tx
      .select({ customer: customers, ownerName: users.name })
      .from(customers)
      .innerJoin(users, eq(users.id, customers.ownerId))
      .where(and(...conditions))
      .orderBy(asc(customers.name));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.customer.id);

    const contacts = await tx
      .select()
      .from(customerContacts)
      .where(and(inArray(customerContacts.customerId, ids), eq(customerContacts.active, true), eq(customerContacts.isPrimary, true)));
    const projectRows = await tx
      .select({
        customerId: projects.customerId,
        currency: projects.currency,
        count: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${projects.status} not in ('COMPLETED', 'CANCELLED'))::int`,
        total: sql<number>`coalesce(sum(${projects.totalValueMinor}) filter (where ${projects.status} <> 'CANCELLED'), 0)::bigint`,
      })
      .from(projects)
      .where(inArray(projects.customerId, ids))
      .groupBy(projects.customerId, projects.currency);

    return rows.map(({ customer, ownerName }) => {
      const own = projectRows.filter((p) => p.customerId === customer.id);
      const primary = contacts.find((c) => c.customerId === customer.id);
      return {
        id: customer.id,
        name: customer.name,
        type: customer.type,
        status: customer.status,
        ownerName,
        primaryContact: primary ? { name: primary.name, email: primary.email, phone: primary.phone } : null,
        projectCount: own.reduce((n, p) => n + p.count, 0),
        openProjectCount: own.reduce((n, p) => n + p.open, 0),
        valueByCurrency: own.filter((p) => Number(p.total) > 0).map((p) => ({ currency: p.currency, totalMinor: Number(p.total) })),
        createdAt: customer.createdAt,
      };
    });
  });
}

export async function getCustomer(actor: Actor, customerId: string) {
  assertCan(actor, "customer.view");
  if (!z.uuid().safeParse(customerId).success) return null;
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ customer: customers, ownerName: users.name })
      .from(customers)
      .innerJoin(users, eq(users.id, customers.ownerId))
      .where(eq(customers.id, customerId));
    if (!row) return null;
    const contacts = await tx
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId))
      .orderBy(desc(customerContacts.active), desc(customerContacts.isPrimary), asc(customerContacts.name));
    const linkedProjects = await tx
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        status: projects.status,
        totalValueMinor: projects.totalValueMinor,
        currency: projects.currency,
        targetDate: projects.targetDate,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.customerId, customerId))
      .orderBy(desc(projects.createdAt));
    const activity = await tx
      .select({ event: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(
        or(
          and(eq(auditEvents.entityType, "customer"), eq(auditEvents.entityId, customerId)),
          contacts.length
            ? and(eq(auditEvents.entityType, "customer_contact"), inArray(auditEvents.entityId, contacts.map((c) => c.id)))
            : undefined,
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(50);
    return {
      customer: row.customer,
      ownerName: row.ownerName,
      contacts,
      projects: linkedProjects,
      activity: activity.map((a) => ({ ...a.event, actorName: a.actorName })),
    };
  });
}

/** Customers a project can be linked to: not archived, plus the one it already has. */
export async function listCustomerOptions(actor: Actor, includeId?: string | null) {
  assertCan(actor, "customer.view");
  return withActor(actor, (tx) =>
    tx
      .select({ id: customers.id, name: customers.name, status: customers.status })
      .from(customers)
      .where(includeId ? or(ne(customers.status, "ARCHIVED"), eq(customers.id, includeId)) : ne(customers.status, "ARCHIVED"))
      .orderBy(asc(customers.name)),
  );
}

export async function createCustomer(actor: Actor, raw: z.input<typeof customerInput>, request?: RequestMeta) {
  assertCan(actor, "customer.manage");
  const input = customerInput.parse(raw);
  return withActor(actor, async (tx) => {
    await assertActiveOwner(tx, input.ownerId);
    const [created] = await guarded(input.name, () =>
      tx
        .insert(customers)
        .values({ ...input, notes: input.notes ?? null, externalReference: input.externalReference ?? null, createdBy: actor.id })
        .returning(),
    );
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "customer",
      entityId: created.id,
      action: "customer.created",
      after: auditableCustomer(created),
      request,
    });
    return created;
  });
}

export async function updateCustomer(
  actor: Actor,
  customerId: string,
  raw: z.input<typeof customerInput> & { version: number | string },
  request?: RequestMeta,
) {
  assertCan(actor, "customer.manage");
  const input = customerInput.parse(raw);
  return withActor(actor, async (tx) => {
    const customer = await lockCustomer(tx, customerId);
    if (customer.status === "ARCHIVED") throw new ServiceError("Restore this customer before editing it.");
    if (customer.version !== Number(raw.version)) {
      throw new ServiceError("Someone else changed this customer meanwhile. Reload the page and try again.");
    }
    if (input.ownerId !== customer.ownerId) await assertActiveOwner(tx, input.ownerId);
    const [updated] = await guarded(input.name, () =>
      tx
        .update(customers)
        .set({
          ...input,
          notes: input.notes ?? null,
          externalReference: input.externalReference ?? null,
          version: customer.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId))
        .returning(),
    );
    if (updated.name !== customer.name) {
      // Projects keep a copy of the client name for display and reports; keep it in step.
      await tx.update(projects).set({ clientName: updated.name }).where(eq(projects.customerId, customerId));
    }
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "customer",
      entityId: customerId,
      action: "customer.updated",
      before: auditableCustomer(customer),
      after: auditableCustomer(updated),
      request,
    });
    return updated;
  });
}

export const archiveInput = z.object({ reason });

export async function archiveCustomer(actor: Actor, customerId: string, raw: z.input<typeof archiveInput>, request?: RequestMeta) {
  assertCan(actor, "customer.manage");
  const input = archiveInput.parse(raw);
  await withActor(actor, async (tx) => {
    const customer = await lockCustomer(tx, customerId);
    if (customer.status === "ARCHIVED") throw new ServiceError("This customer is already archived.");
    const [open] = await tx
      .select({ code: projects.code })
      .from(projects)
      .where(and(eq(projects.customerId, customerId), sql`${projects.status} not in ('COMPLETED', 'CANCELLED')`))
      .limit(1);
    if (open) throw new ServiceError(`Finish or cancel this customer's open projects first (${open.code}).`);
    if ((await openSubscriptionCount(tx, customerId)) > 0) {
      throw new ServiceError("End or cancel this customer's subscriptions first.");
    }
    await tx
      .update(customers)
      .set({ status: "ARCHIVED", archivedAt: new Date(), version: customer.version + 1, updatedAt: new Date() })
      .where(eq(customers.id, customerId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "customer",
      entityId: customerId,
      action: "customer.archived",
      before: { status: customer.status },
      after: { status: "ARCHIVED" },
      reason: input.reason,
      request,
    });
  });
}

export async function restoreCustomer(actor: Actor, customerId: string, raw: z.input<typeof archiveInput>, request?: RequestMeta) {
  assertCan(actor, "customer.manage");
  const input = archiveInput.parse(raw);
  await withActor(actor, async (tx) => {
    const customer = await lockCustomer(tx, customerId);
    if (customer.status !== "ARCHIVED") throw new ServiceError("This customer is not archived.");
    await tx
      .update(customers)
      .set({ status: "ACTIVE", archivedAt: null, version: customer.version + 1, updatedAt: new Date() })
      .where(eq(customers.id, customerId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "customer",
      entityId: customerId,
      action: "customer.restored",
      before: { status: "ARCHIVED" },
      after: { status: "ACTIVE" },
      reason: input.reason,
      request,
    });
  });
}

/** Only one active primary contact per customer: clear the others first. */
async function clearPrimary(tx: Tx, customerId: string, exceptId?: string) {
  await tx
    .update(customerContacts)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        eq(customerContacts.customerId, customerId),
        eq(customerContacts.isPrimary, true),
        exceptId ? ne(customerContacts.id, exceptId) : undefined,
      ),
    );
}

export async function addContact(actor: Actor, customerId: string, raw: z.input<typeof contactInput>, request?: RequestMeta) {
  assertCan(actor, "customer.manage");
  const input = contactInput.parse(raw);
  return withActor(actor, async (tx) => {
    const customer = await lockCustomer(tx, customerId);
    if (customer.status === "ARCHIVED") throw new ServiceError("Restore this customer before adding contacts.");
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(customerContacts)
      .where(and(eq(customerContacts.customerId, customerId), eq(customerContacts.active, true)));
    // The first contact becomes the primary one.
    const isPrimary = input.isPrimary || count === 0;
    if (isPrimary) await clearPrimary(tx, customerId);
    const [contact] = await tx
      .insert(customerContacts)
      .values({ ...input, role: input.role ?? null, email: input.email ?? null, phone: input.phone ?? null, isPrimary, customerId })
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "customer_contact",
      entityId: contact.id,
      action: "contact.added",
      after: auditableContact(contact),
      request,
    });
    return contact;
  });
}

async function lockContact(tx: Tx, contactId: string) {
  const [contact] = await tx.select().from(customerContacts).where(eq(customerContacts.id, contactId)).for("update");
  if (!contact) throw new ServiceError("Contact not found.");
  const customer = await lockCustomer(tx, contact.customerId);
  if (customer.status === "ARCHIVED") throw new ServiceError("Restore this customer before changing its contacts.");
  return contact;
}

export async function updateContact(actor: Actor, contactId: string, raw: z.input<typeof contactInput>, request?: RequestMeta) {
  assertCan(actor, "customer.manage");
  const input = contactInput.parse(raw);
  return withActor(actor, async (tx) => {
    const contact = await lockContact(tx, contactId);
    if (!contact.active) throw new ServiceError("Reactivate this contact before editing it.");
    if (input.isPrimary) await clearPrimary(tx, contact.customerId, contactId);
    const [updated] = await tx
      .update(customerContacts)
      .set({ ...input, role: input.role ?? null, email: input.email ?? null, phone: input.phone ?? null, updatedAt: new Date() })
      .where(eq(customerContacts.id, contactId))
      .returning()
      .catch(rethrowDbGuard);
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "customer_contact",
      entityId: contactId,
      action: "contact.updated",
      before: auditableContact(contact),
      after: auditableContact(updated),
      request,
    });
    return updated;
  });
}

export async function setContactActive(actor: Actor, contactId: string, active: boolean, request?: RequestMeta) {
  assertCan(actor, "customer.manage");
  await withActor(actor, async (tx) => {
    const contact = await lockContact(tx, contactId);
    if (contact.active === active) throw new ServiceError(active ? "This contact is already active." : "This contact is already inactive.");
    // A deactivated contact stops being the primary one; a reactivated contact comes back as non-primary.
    await tx
      .update(customerContacts)
      .set({ active, isPrimary: false, updatedAt: new Date() })
      .where(eq(customerContacts.id, contactId));
    await recordAudit(tx, {
      actorId: actor.id,
      entityType: "customer_contact",
      entityId: contactId,
      action: active ? "contact.reactivated" : "contact.deactivated",
      before: { active: contact.active, isPrimary: contact.isPrimary },
      after: { active, isPrimary: false },
      request,
    });
  });
}

/**
 * The customer an external project links to, inside the project's transaction. Either an existing
 * customer (by id) or, when only a name is given, the customer with that name, created if missing.
 * `currentCustomerId` lets a project keep a customer that has since been archived.
 */
export async function resolveProjectCustomer(
  tx: Tx,
  actor: Actor,
  input: { customerId?: string | null; clientName?: string | null; ownerId: string },
  currentCustomerId: string | null = null,
  request?: RequestMeta,
): Promise<{ id: string; name: string }> {
  if (input.customerId) {
    const [customer] = await tx
      .select({ id: customers.id, name: customers.name, status: customers.status })
      .from(customers)
      .where(eq(customers.id, input.customerId));
    if (!customer) throw new ServiceError("Customer not found.");
    if (customer.status === "ARCHIVED" && customer.id !== currentCustomerId) {
      throw new ServiceError(`${customer.name} is archived. Restore it before linking new projects.`);
    }
    return customer;
  }
  const name = customerName.parse(input.clientName ?? "");
  const [existing] = await tx
    .select({ id: customers.id, name: customers.name, status: customers.status })
    .from(customers)
    .where(eq(sql`lower(btrim(${customers.name}))`, name.toLowerCase()));
  if (existing) {
    if (existing.status === "ARCHIVED" && existing.id !== currentCustomerId) {
      throw new ServiceError(`${existing.name} is archived. Restore it before linking new projects.`);
    }
    return existing;
  }
  assertCan(actor, "customer.manage");
  // The new customer's account owner is the project owner when they can own accounts, else the actor.
  const [owner] = await tx.select({ role: users.role, active: users.active }).from(users).where(eq(users.id, input.ownerId));
  const ownerId = owner && owner.active && owner.role !== "TEAM_MEMBER" ? input.ownerId : actor.id;
  const [created] = await guarded(name, () =>
    tx.insert(customers).values({ name, ownerId, createdBy: actor.id }).returning(),
  );
  await recordAudit(tx, {
    actorId: actor.id,
    entityType: "customer",
    entityId: created.id,
    action: "customer.created",
    after: auditableCustomer(created),
    request,
  });
  return created;
}
