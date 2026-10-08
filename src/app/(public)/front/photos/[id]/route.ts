import { openFrontPhoto } from "@/modules/community/front";

// Phase 35: a front page photo (public). Only checked images are stored; the browser is told not
// to guess types or run anything.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await openFrontPhoto(id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body as BodyInit, {
    headers: {
      "Content-Type": file.photo.contentType,
      "Content-Length": String(file.photo.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "public, max-age=86400",
      "Referrer-Policy": "no-referrer",
    },
  });
}
