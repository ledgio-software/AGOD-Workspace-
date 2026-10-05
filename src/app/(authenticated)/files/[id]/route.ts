import { isInlineType } from "@/lib/files";
import { getCurrentUser } from "@/lib/session";
import { openAttachment } from "@/modules/attachments";

// Serves an attachment after checking, as the signed-in person, that they may see it (row-level
// security). Only images and PDFs are shown in the browser; everything else downloads, and the
// browser is told not to guess types or run anything.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const file = await openAttachment(actor, id);
  if (!file) return new Response("Not found", { status: 404 });

  const inline = isInlineType(file.row.contentType);
  const encoded = encodeURIComponent(file.row.fileName);
  const ascii = file.row.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(file.body as BodyInit, {
    headers: {
      "Content-Type": inline ? file.row.contentType : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Content-Length": String(file.row.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      // Browsers' PDF viewers need to run; images and downloads get a locked-down policy.
      ...(file.row.contentType === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }),
      "Referrer-Policy": "no-referrer",
    },
  });
}
