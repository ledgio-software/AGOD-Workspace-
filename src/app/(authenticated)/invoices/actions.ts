"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionResult, runAction } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/session";
import { ServiceError } from "@/modules/errors";
import {
  addInvoiceLine,
  addSubscriptionPeriod,
  createDraftInvoice,
  deleteDraftInvoice,
  invoiceSubscription,
  issueInvoice,
  prepareSubscriptionInvoices,
  recordInvoicePayment,
  removeInvoiceLine,
  updateDraftNotes,
  updateInvoiceSettings,
  voidInvoice,
  voidInvoicePayment,
} from "@/modules/invoices";
import { type DriveSave, saveInvoiceToDrive, trySaveInvoiceToDrive } from "@/modules/invoices/drive";
import { sendInvoiceEmail } from "@/modules/invoices/send";

type Result = ActionResult<undefined>;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function refresh(invoiceId?: string) {
  revalidatePath("/invoices");
  revalidatePath("/customers");
  revalidatePath("/dashboard");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
}

export async function createDraftAction(_prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  let id = "";
  const result = await runAction(async () => {
    id = (await createDraftInvoice(actor, { customerId: text(form, "customerId"), notes: text(form, "notes") }, await getRequestMeta())).id;
    return undefined;
  });
  if (!result.ok) return result;
  refresh();
  redirect(`/invoices/${id}`);
}

export async function invoiceSubscriptionAction(subscriptionId: string): Promise<Result> {
  const actor = await requireUser();
  let id = "";
  const result = await runAction(async () => {
    id = (await invoiceSubscription(actor, subscriptionId, await getRequestMeta())).id;
    return undefined;
  });
  if (!result.ok) return result;
  refresh();
  redirect(`/invoices/${id}`);
}

export async function prepareAction(_prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    const r = await prepareSubscriptionInvoices(actor, { through: text(form, "through") || undefined }, await getRequestMeta());
    if (r.lines === 0) throw new ServiceError(`Nothing to bill: every active subscription is billed up to ${r.through}.`);
    return undefined;
  }, "Drafts prepared. Check them below, then issue each one.");
  if (result.ok) refresh();
  return result;
}

export async function addLineAction(invoiceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await addInvoiceLine(
      actor,
      invoiceId,
      { description: text(form, "description"), quantity: text(form, "quantity") as never, unitPrice: text(form, "unitPrice"), projectId: text(form, "projectId") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Line added.");
  if (result.ok) refresh(invoiceId);
  return result;
}

export async function addPeriodAction(invoiceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await addSubscriptionPeriod(actor, invoiceId, text(form, "subscriptionId"), await getRequestMeta());
    return undefined;
  }, "Period added.");
  if (result.ok) refresh(invoiceId);
  return result;
}

export async function removeLineAction(invoiceId: string, lineId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await removeInvoiceLine(actor, lineId, await getRequestMeta());
    return undefined;
  });
  if (result.ok) refresh(invoiceId);
  return result;
}

export async function notesAction(invoiceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateDraftNotes(actor, invoiceId, { notes: text(form, "notes"), version: text(form, "version") }, await getRequestMeta());
    return undefined;
  }, "Notes saved.");
  if (result.ok) refresh(invoiceId);
  return result;
}

export async function deleteDraftAction(invoiceId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await deleteDraftInvoice(actor, invoiceId, await getRequestMeta());
    return undefined;
  });
  if (!result.ok) return result;
  refresh();
  redirect("/invoices");
}

export async function issueAction(invoiceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await issueInvoice(actor, invoiceId, { issueDate: text(form, "issueDate"), dueDate: text(form, "dueDate"), version: text(form, "version") as never }, await getRequestMeta());
    return trySaveInvoiceToDrive(actor, invoiceId);
  });
  if (!result.ok) return result;
  refresh(invoiceId);
  const saved: DriveSave = result.data;
  return {
    ok: true,
    data: undefined,
    message:
      saved === "saved"
        ? "Invoice issued and saved to Google Drive."
        : saved === "failed"
          ? "Invoice issued. Saving it to Google Drive failed; use “Save to Drive” to try again."
          : "Invoice issued.",
  };
}

export async function saveToDriveAction(invoiceId: string): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    if ((await saveInvoiceToDrive(actor, invoiceId)) === "off") throw new ServiceError("Google Drive is not connected. An Admin connects it on the Integrations page.");
    return undefined;
  }, "Saved to Google Drive.");
  refresh(invoiceId);
  return result;
}

export async function voidAction(invoiceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await voidInvoice(actor, invoiceId, { reason: text(form, "reason") }, await getRequestMeta());
    return undefined;
  }, "Invoice voided.");
  if (result.ok) refresh(invoiceId);
  return result;
}

export async function paymentAction(invoiceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await recordInvoicePayment(
      actor,
      invoiceId,
      { amount: text(form, "amount"), paidOn: text(form, "paidOn"), method: text(form, "method") as "CASH", reference: text(form, "reference"), note: text(form, "note") },
      await getRequestMeta(),
    );
    return undefined;
  }, "Payment recorded.");
  if (result.ok) refresh(invoiceId);
  return result;
}

export async function voidPaymentAction(invoiceId: string, paymentId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await voidInvoicePayment(actor, paymentId, { reason: text(form, "reason") }, await getRequestMeta());
    return undefined;
  }, "Payment voided.");
  if (result.ok) refresh(invoiceId);
  return result;
}

export async function sendAction(invoiceId: string, _prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  let to = "";
  const result = await runAction(async () => {
    to = await sendInvoiceEmail(actor, invoiceId, text(form, "to") || undefined, await getRequestMeta());
    return undefined;
  });
  if (!result.ok) return result;
  refresh(invoiceId);
  return { ok: true, data: undefined, message: `Sent to ${to}.` };
}

export async function settingsAction(_prev: Result | null, form: FormData): Promise<Result> {
  const actor = await requireUser();
  const result = await runAction(async () => {
    await updateInvoiceSettings(
      actor,
      {
        businessName: text(form, "businessName"),
        address: text(form, "address"),
        email: text(form, "email"),
        phone: text(form, "phone"),
        taxId: text(form, "taxId"),
        paymentInstructions: text(form, "paymentInstructions"),
        footer: text(form, "footer"),
        defaultDueDays: text(form, "defaultDueDays") as never,
      },
      await getRequestMeta(),
    );
    return undefined;
  }, "Invoice settings saved.");
  if (result.ok) {
    revalidatePath("/invoices/settings");
    revalidatePath("/invoices");
  }
  return result;
}
