import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { type Actor, assertCan } from "@/lib/permissions";
import { ServiceError } from "@/modules/errors";
import { saveInvoicePdf } from "@/modules/google";
import { getInvoice } from "./index";
import { invoicePdf } from "./pdf";
import { invoiceFilename, pdfInputFor } from "./send";

// Phase 21: a copy of each issued invoice's PDF in the customer's Drive "Invoices" folder. Saved
// right after issuing (best effort); "Save to Drive" on the invoice retries.

export type DriveSave = "saved" | "already" | "off" | "failed";

export async function saveInvoiceToDrive(actor: Actor, invoiceId: string): Promise<DriveSave> {
  assertCan(actor, "invoice.manage");
  const data = await getInvoice(actor, invoiceId);
  if (!data) throw new ServiceError("Invoice not found.");
  const i = data.invoice;
  if (i.status !== "ISSUED") throw new ServiceError("Only issued invoices are saved to Drive.");
  if (i.driveFileId) return "already";
  const bytes = await invoicePdf(pdfInputFor(data));
  const fileId = await saveInvoicePdf(i.customerId, {
    name: invoiceFilename(i.number),
    bytes,
    description: `Invoice ${i.number} for ${data.customerName}, issued ${i.issueDate}`,
  });
  if (!fileId) return "off";
  // Through the owner connection: only this column changes, and the invoice guard allows it.
  await db.update(invoices).set({ driveFileId: fileId }).where(and(eq(invoices.id, invoiceId), isNull(invoices.driveFileId)));
  return "saved";
}

/** For the issue action: tries once, never fails the issue itself. */
export async function trySaveInvoiceToDrive(actor: Actor, invoiceId: string): Promise<DriveSave> {
  try {
    return await saveInvoiceToDrive(actor, invoiceId);
  } catch (error) {
    console.error("Saving the invoice to Drive failed", invoiceId, error instanceof Error ? error.message : error);
    return "failed";
  }
}
