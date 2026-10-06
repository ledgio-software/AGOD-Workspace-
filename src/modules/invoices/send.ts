import "server-only";
import { emailConfig, sendEmail } from "@/lib/email";
import { formatMoney } from "@/lib/money";
import type { Actor } from "@/lib/permissions";
import { assertCan } from "@/lib/permissions";
import { type RequestMeta } from "@/modules/audit";
import { ServiceError } from "@/modules/errors";
import { getInvoice, markInvoiceSent } from "./index";
import { type InvoicePdfInput, invoicePdf } from "./pdf";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The data the PDF needs, from a loaded invoice. */
export function pdfInputFor(data: NonNullable<Awaited<ReturnType<typeof getInvoice>>>): InvoicePdfInput {
  const i = data.invoice;
  const s = data.settings;
  return {
    number: i.number,
    status: i.status,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    currency: i.currency,
    totalMinor: i.totalMinor,
    paidMinor: i.paidMinor,
    billToName: i.billToName,
    customerName: data.customerName,
    notes: i.notes,
    paid: data.state === "PAID",
    lines: data.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, amountMinor: l.amountMinor })),
    seller: {
      businessName: s?.businessName ?? "AGOD",
      address: s?.address ?? null,
      email: s?.email ?? null,
      phone: s?.phone ?? null,
      taxId: s?.taxId ?? null,
      paymentInstructions: s?.paymentInstructions ?? null,
      footer: s?.footer ?? null,
    },
  };
}

export function invoiceFilename(number: string | null): string {
  return `${number ?? "draft-invoice"}.pdf`;
}

/**
 * Emails an issued invoice (PDF attached) to its billing contact, or to `override`, and records
 * that it was sent. The recipient is the contact copied onto the invoice when it was issued.
 */
export async function sendInvoiceEmail(actor: Actor, invoiceId: string, override?: string, request?: RequestMeta): Promise<string> {
  assertCan(actor, "invoice.manage");
  const config = emailConfig();
  if (!config) throw new ServiceError("Email is not set up on this environment (see the Integrations page).");
  const data = await getInvoice(actor, invoiceId);
  if (!data) throw new ServiceError("Invoice not found.");
  const i = data.invoice;
  if (i.status !== "ISSUED") throw new ServiceError("Only issued invoices are sent.");
  const to = (override ?? i.billToEmail ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new ServiceError("This invoice has no email address to send to. Add a contact with an email to the customer, or type one in.");
  }
  const seller = data.settings?.businessName ?? "AGOD";
  const balance = formatMoney(data.balanceMinor, i.currency);
  const text = [
    `Hello,`,
    "",
    `Please find attached invoice ${i.number} from ${seller} for ${formatMoney(i.totalMinor, i.currency)}${data.balanceMinor !== i.totalMinor ? ` (balance ${balance})` : ""}, due ${i.dueDate}.`,
    ...(data.settings?.paymentInstructions ? ["", "How to pay:", data.settings.paymentInstructions] : []),
    "",
    `Thank you,`,
    seller,
  ].join("\n");
  const html = `<p>Hello,</p><p>Please find attached invoice <strong>${escapeHtml(i.number ?? "")}</strong> from ${escapeHtml(seller)} for <strong>${escapeHtml(formatMoney(i.totalMinor, i.currency))}</strong>, due ${escapeHtml(i.dueDate ?? "")}.</p>${
    data.settings?.paymentInstructions ? `<p><strong>How to pay</strong><br>${escapeHtml(data.settings.paymentInstructions).replace(/\n/g, "<br>")}</p>` : ""
  }<p>Thank you,<br>${escapeHtml(seller)}</p>`;
  const pdf = await invoicePdf(pdfInputFor(data));
  try {
    await sendEmail(config, {
      to,
      subject: `Invoice ${i.number} from ${seller}`,
      text,
      html,
      attachments: [{ filename: invoiceFilename(i.number), content: pdf, contentType: "application/pdf" }],
    });
  } catch (error) {
    throw new ServiceError(error instanceof Error ? error.message : "The email could not be sent.");
  }
  await markInvoiceSent(actor, invoiceId, to, request);
  return to;
}
