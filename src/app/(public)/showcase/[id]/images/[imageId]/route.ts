import { getSignedIn } from "@/lib/session";
import { openScreenshot } from "@/modules/community/showcase";

// Phase 26: a showcase screenshot, for whoever may see its project. Only images are stored
// (their bytes are checked on upload); the browser is told not to guess types or run anything.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const { id, imageId } = await params;
  const file = await openScreenshot(id, imageId, await getSignedIn());
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body as BodyInit, {
    headers: {
      "Content-Type": file.image.contentType,
      "Content-Length": String(file.image.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      // Members-only projects' screenshots must not be cached by shared caches.
      "Cache-Control": "private, max-age=3600",
      "Referrer-Policy": "no-referrer",
    },
  });
}
