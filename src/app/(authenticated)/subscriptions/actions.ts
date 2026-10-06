"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import {
  amendSubscription,
  changeSubscriptionStatus,
  createService,
  createSubscription,
  renewSubscription,
  setServiceActive,
  updateDraftSubscription,
  updateService,
  updateSubscriptionDetails,
} from "@/modules/subscriptions";

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function termFields(form: FormData) {
  return {
    billingCadence: text(form, "billingCadence") as "MONTHLY",
    price: text(form, "price"),
    pricingBasis: text(form, "pricingBasis") as "FIXED",
    quantity: text(form, "quantity"),
    endDate: text(form, "endDate"),
    renewalDate: text(form, "renewalDate"),
    noticePeriodDays: text(form, "noticePeriodDays"),
    paymentTerms: text(form, "paymentTerms"),
  };
}

function detailFields(form: FormData) {
  return {
    ownerId: text(form, "ownerId"),
    renewalOwnerId: text(form, "renewalOwnerId"),
    externalReference: text(form, "externalReference"),
    notes: text(form, "notes"),
  };
}

function refresh(subscriptionId?: string, customerId?: string) {
  revalidatePath("/subscriptions");
  revalidatePath("/services");
  revalidatePath("/customers");
  if (subscriptionId) revalidatePath(`/subscriptions/${subscriptionId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function createSubscriptionAction(_prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  let id = "";
  const result = await runAction(async () => {
    const created = await createSubscription(
      actor,
      {
        customerId: text(form, "customerId"),
        serviceId: text(form, "serviceId"),
        startDate: text(form, "startDate"),
        ...termFields(form),
        ...detailFields(form),
        activate: text(form, "activate") === "true",
      },
      await getRequestMeta(),
    );
    id = created.id;
    return undefined;
  });
  if (!result.ok) return result;
  refresh(undefined, text(form, "customerId"));
  redirect(`/subscriptions/${id}`);
}

export async function updateDraftAction(subscriptionId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateDraftSubscription(
      actor,
      subscriptionId,
      { startDate: text(form, "startDate"), ...termFields(form), ...detailFields(form), version: text(form, "version") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Draft saved.");
  if (result.ok) refresh(subscriptionId);
  return result;
}

export async function updateDetailsAction(subscriptionId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateSubscriptionDetails(actor, subscriptionId, { ...detailFields(form), version: text(form, "version") }, await getRequestMeta());
    return undefined;
  }, "Details saved.");
  if (result.ok) refresh(subscriptionId);
  return result;
}

export async function amendAction(subscriptionId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await amendSubscription(
      actor,
      subscriptionId,
      { ...termFields(form), effectiveDate: text(form, "effectiveDate"), reason: text(form, "reason"), version: text(form, "version") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Amendment recorded.");
  if (result.ok) refresh(subscriptionId);
  return result;
}

export async function renewAction(subscriptionId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await renewSubscription(
      actor,
      subscriptionId,
      {
        renewalDate: text(form, "renewalDate"),
        endDate: text(form, "endDate"),
        price: text(form, "price"),
        reason: text(form, "reason"),
        version: text(form, "version"),
      },
      await getRequestMeta(),
    );
    return undefined;
  }, "Renewal recorded.");
  if (result.ok) refresh(subscriptionId);
  return result;
}

export async function changeStatusAction(subscriptionId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await changeSubscriptionStatus(
      actor,
      subscriptionId,
      { to: text(form, "to") as "ACTIVE", reason: text(form, "reason"), version: text(form, "version") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Status updated.");
  if (result.ok) refresh(subscriptionId);
  return result;
}

function serviceFields(form: FormData) {
  return {
    code: text(form, "code"),
    name: text(form, "name"),
    description: text(form, "description"),
    defaultCadence: text(form, "defaultCadence") as "MONTHLY",
    defaultPrice: text(form, "defaultPrice"),
  };
}

export async function createServiceAction(_prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await createService(actor, serviceFields(form), await getRequestMeta());
    return undefined;
  }, "Service added.");
  if (result.ok) refresh();
  return result;
}

export async function updateServiceAction(serviceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateService(actor, serviceId, { ...serviceFields(form), version: text(form, "version") }, await getRequestMeta());
    return undefined;
  }, "Service saved.");
  if (result.ok) refresh();
  return result;
}

export async function setServiceActiveAction(serviceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const active = text(form, "active") === "true";
  const result = await runAction(async () => {
    await setServiceActive(actor, serviceId, active, await getRequestMeta());
    return undefined;
  }, active ? "Service offered again." : "Service retired.");
  if (result.ok) refresh();
  return result;
}
