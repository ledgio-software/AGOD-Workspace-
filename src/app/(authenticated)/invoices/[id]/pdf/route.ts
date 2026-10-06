import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { getInvoice } from "@/modules/invoices";
import { invoicePdf } from "@/modules/invoices/pdf";
import { invoiceFilename, pdfInputFor } from "@/modules/invoices/send";

// The invoice as a PDF. Managers only; row-level security applies again in getInvoice.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in required", { status: 401 });
  if (!can(actor, "invoice.view")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const data = await getInvoice(actor, id);
  if (!data) return new Response("Not found", { status: 404 });
  const bytes = await invoicePdf(pdfInputFor(data));
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoiceFilename(data.invoice.number)}"`,
      "Cache-Control": "no-store",
    },
  });
}
