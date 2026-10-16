// Render's health check (render.yaml): answers as soon as the server is up. It doesn't touch the
// database, so a slow database can't make Render restart a healthy server.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true });
}
