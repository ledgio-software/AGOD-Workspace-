import { getSignedIn } from "@/lib/session";
import { getSession, sessionIcs } from "@/modules/community/sessions";

// Phase 27: "Add to calendar". The call link is only in the file for people who may see it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await getSession((await params).id, await getSignedIn());
  if (!found) return new Response("Not found", { status: 404 });
  return new Response(sessionIcs(found.session), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="session.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
