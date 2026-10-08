import { openCover } from "@/modules/community/articles";

// Phase 37: an article's cover picture (public, published articles only). Only checked images are
// stored; the browser is told not to guess types or run anything.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await openCover(id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body as BodyInit, {
    headers: {
      "Content-Type": file.type,
      "Content-Length": String(file.bytes),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      // Short, because the author can change the cover under the same address.
      "Cache-Control": "public, max-age=300",
      "Referrer-Policy": "no-referrer",
    },
  });
}
