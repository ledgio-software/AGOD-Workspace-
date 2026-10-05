"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import {
  addContact,
  archiveCustomer,
  createCustomer,
  restoreCustomer,
  setContactActive,
  updateContact,
  updateCustomer,
} from "@/modules/customers";

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function customerFields(form: FormData) {
  return {
    name: text(form, "name"),
    type: text(form, "type") as "COMPANY",
    status: text(form, "status") as "ACTIVE",
    ownerId: text(form, "ownerId"),
    notes: text(form, "notes"),
    externalReference: text(form, "externalReference"),
  };
}

function contactFields(form: FormData) {
  return {
    name: text(form, "name"),
    role: text(form, "role"),
    email: text(form, "email"),
    phone: text(form, "phone"),
    preferredChannel: text(form, "preferredChannel") as "EMAIL",
    isPrimary: form.get("isPrimary") === "on",
    isBilling: form.get("isBilling") === "on",
  };
}

function refresh(customerId?: string) {
  revalidatePath("/customers");
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function createCustomerAction(_prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  let id = "";
  const result = await runAction(async () => {
    id = (await createCustomer(actor, customerFields(form), await getRequestMeta())).id;
    return undefined;
  });
  if (!result.ok) return result;
  refresh();
  redirect(`/customers/${id}`);
}

export async function updateCustomerAction(customerId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateCustomer(actor, customerId, { ...customerFields(form), version: text(form, "version") }, await getRequestMeta());
    return undefined;
  }, "Customer saved.");
  if (result.ok) {
    refresh(customerId);
    // A rename changes the client name shown on projects.
    revalidatePath("/projects");
  }
  return result;
}

export async function archiveCustomerAction(customerId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const restore = text(form, "restore") === "true";
  const result = await runAction(async () => {
    const input = { reason: text(form, "reason") };
    if (restore) await restoreCustomer(actor, customerId, input, await getRequestMeta());
    else await archiveCustomer(actor, customerId, input, await getRequestMeta());
    return undefined;
  }, restore ? "Customer restored." : "Customer archived.");
  if (result.ok) refresh(customerId);
  return result;
}

export async function addContactAction(customerId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await addContact(actor, customerId, contactFields(form), await getRequestMeta());
    return undefined;
  }, "Contact added.");
  if (result.ok) refresh(customerId);
  return result;
}

export async function updateContactAction(customerId: string, contactId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateContact(actor, contactId, contactFields(form), await getRequestMeta());
    return undefined;
  }, "Contact saved.");
  if (result.ok) refresh(customerId);
  return result;
}

export async function setContactActiveAction(customerId: string, contactId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const active = text(form, "active") === "true";
  const result = await runAction(async () => {
    await setContactActive(actor, contactId, active, await getRequestMeta());
    return undefined;
  }, active ? "Contact reactivated." : "Contact deactivated.");
  if (result.ok) refresh(customerId);
  return result;
}
