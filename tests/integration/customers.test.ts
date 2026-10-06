import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withActor } from "@/lib/db/actor";
import { auditEvents, customerContacts, customers, projects } from "@/lib/db/schema";
import { PermissionError } from "@/lib/permissions";
import {
  addContact,
  archiveCustomer,
  createCustomer,
  getCustomer,
  listCustomers,
  restoreCustomer,
  setContactActive,
  updateContact,
  updateCustomer,
} from "@/modules/customers";
import { changeProjectStatus, createProject, updateProject } from "@/modules/projects";
import { createUser, db, expectDbError } from "./fixtures";

const uniqueName = (base = "Customer") => `${base} ${randomUUID().slice(0, 8)}`;

const customerFor = (ownerId: string, overrides = {}) => ({
  name: uniqueName(),
  type: "COMPANY" as const,
  status: "ACTIVE" as const,
  ownerId,
  ...overrides,
});

const externalProject = (ownerId: string, overrides: Record<string, unknown> = {}) => ({
  name: `Project ${randomUUID().slice(0, 6)}`,
  clientType: "EXTERNAL" as const,
  totalValue: "5,000.00",
  splitMode: "PERCENTAGE" as const,
  projectOwnerId: ownerId,
  ...overrides,
});

describe("customers", () => {
  it("only managers can see or manage customers, and the database agrees", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const customer = await createCustomer(pm, customerFor(pm.id));
    await expect(listCustomers(member)).rejects.toThrow(PermissionError);
    await expect(createCustomer(member, customerFor(member.id))).rejects.toThrow(PermissionError);
    // Bypassing the service: RLS hides customers and contacts from members and refuses inserts.
    const seen = await withActor(member, (tx) => tx.select().from(customers).where(eq(customers.id, customer.id)));
    expect(seen).toHaveLength(0);
    await expectDbError(
      withActor(member, (tx) => tx.insert(customers).values({ name: uniqueName(), ownerId: member.id, createdBy: member.id })),
      /row-level security/,
    );
  });

  it("refuses duplicate names (case and spaces ignored) and an owner who is a team member", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const member = await createUser("TEAM_MEMBER");
    const name = uniqueName("Northwind");
    await createCustomer(pm, customerFor(pm.id, { name }));
    await expect(createCustomer(pm, customerFor(pm.id, { name: `  ${name.toUpperCase()} ` }))).rejects.toThrow(/already exists/);
    await expect(createCustomer(pm, customerFor(member.id))).rejects.toThrow(/Project Manager or Admin/);
  });

  it("cannot be deleted, even by the database owner role used by the app", async () => {
    const admin = await createUser("ADMIN");
    const customer = await createCustomer(admin, customerFor(admin.id));
    await expectDbError(db.delete(customers).where(eq(customers.id, customer.id)), /cannot be deleted/);
  });

  it("renaming a customer renames the client on its projects, and edits check the version", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const customer = await createCustomer(pm, customerFor(pm.id));
    const project = await createProject(pm, externalProject(pm.id, { customerId: customer.id }));
    expect(project.customerId).toBe(customer.id);
    expect(project.clientName).toBe(customer.name);

    const newName = uniqueName("Renamed");
    await updateCustomer(pm, customer.id, { ...customerFor(pm.id, { name: newName }), version: customer.version });
    const [reloaded] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(reloaded.clientName).toBe(newName);
    await expect(
      updateCustomer(pm, customer.id, { ...customerFor(pm.id, { name: newName }), version: customer.version }),
    ).rejects.toThrow(/changed this customer meanwhile/);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, customer.id));
    expect(events.map((e) => e.action).sort()).toEqual(["customer.created", "customer.updated"]);
  });

  it("archives only without open projects; archived customers take no new projects until restored", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const customer = await createCustomer(pm, customerFor(pm.id));
    const project = await createProject(pm, externalProject(pm.id, { customerId: customer.id }));
    await expect(archiveCustomer(pm, customer.id, { reason: "Contract ended" })).rejects.toThrow(/open projects/);
    await changeProjectStatus(pm, project.id, { to: "CANCELLED", reason: "Client withdrew" });
    await archiveCustomer(pm, customer.id, { reason: "Contract ended" });

    expect((await listCustomers(pm)).some((c) => c.id === customer.id)).toBe(false);
    expect((await listCustomers(pm, { status: "ARCHIVED" })).some((c) => c.id === customer.id)).toBe(true);
    await expect(createProject(pm, externalProject(pm.id, { customerId: customer.id }))).rejects.toThrow(/archived/);
    await expect(createProject(pm, externalProject(pm.id, { clientName: customer.name }))).rejects.toThrow(/archived/);

    await restoreCustomer(pm, customer.id, { reason: "New contract" });
    await createProject(pm, externalProject(pm.id, { customerId: customer.id }));
  });

  it("a project given only a client name finds or creates the customer", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const name = uniqueName("Fresh");
    const first = await createProject(pm, externalProject(pm.id, { clientName: name }));
    const second = await createProject(pm, externalProject(pm.id, { clientName: ` ${name.toLowerCase()} ` }));
    expect(first.customerId).not.toBeNull();
    expect(second.customerId).toBe(first.customerId);
    expect(second.clientName).toBe(name);

    // Switching to internal unlinks the customer.
    const internal = await updateProject(pm, first.id, {
      ...externalProject(pm.id, { name: first.name }),
      clientType: "INTERNAL",
      version: first.version,
    });
    expect(internal.customerId).toBeNull();
    expect(internal.clientName).toBeNull();
  });

  it("the database keeps external projects linked to a customer and internal ones unlinked", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const project = await createProject(pm, externalProject(pm.id, { clientName: uniqueName() }));
    await expectDbError(
      db.update(projects).set({ customerId: null }).where(eq(projects.id, project.id)),
      /projects_customer_matches_client_type/,
    );
  });
});

describe("customer contacts", () => {
  it("keeps one primary contact, needs an email or phone, and records history", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const customer = await createCustomer(pm, customerFor(pm.id));
    const base = { preferredChannel: "EMAIL" as const };

    await expect(addContact(pm, customer.id, { ...base, name: "No Way" })).rejects.toThrow(/email or a phone/);
    const first = await addContact(pm, customer.id, { ...base, name: "Abena Owusu", email: "Abena@Example.com" });
    expect(first.isPrimary).toBe(true); // the first contact becomes primary
    expect(first.email).toBe("abena@example.com");
    const second = await addContact(pm, customer.id, { ...base, name: "Yaw Boateng", phone: "+233 20 000 0000", isPrimary: true, isBilling: true });

    const primaries = async () =>
      (await db.select().from(customerContacts).where(eq(customerContacts.customerId, customer.id))).filter((c) => c.isPrimary).map((c) => c.id);
    expect(await primaries()).toEqual([second.id]);

    await updateContact(pm, first.id, { ...base, name: "Abena Owusu", email: "abena@example.com", isPrimary: true });
    expect(await primaries()).toEqual([first.id]);

    await setContactActive(pm, first.id, false);
    expect(await primaries()).toEqual([]);
    await expect(updateContact(pm, first.id, { ...base, name: "Abena", email: "a@example.com" })).rejects.toThrow(/Reactivate/);
    await expectDbError(db.delete(customerContacts).where(eq(customerContacts.id, first.id)), /cannot be deleted/);

    const detail = await getCustomer(pm, customer.id);
    expect(detail?.contacts).toHaveLength(2);
    expect(detail?.activity.map((a) => a.action)).toEqual(
      expect.arrayContaining(["customer.created", "contact.added", "contact.updated", "contact.deactivated"]),
    );
  });

  it("another PM can read the customer's history", async () => {
    const pm = await createUser("PROJECT_MANAGER");
    const other = await createUser("PROJECT_MANAGER");
    const customer = await createCustomer(pm, customerFor(pm.id));
    const detail = await getCustomer(other, customer.id);
    expect(detail?.activity.map((a) => a.action)).toContain("customer.created");
  });
});
