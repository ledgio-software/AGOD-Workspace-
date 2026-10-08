import { getCurrentUser } from "@/lib/session";
import { openVoiceNote } from "@/modules/messages";

// Phase 34: plays a voice note to the people in its conversation (row-level security). Supports
// byte ranges, which Safari needs to play audio.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const note = await openVoiceNote(actor, id);
  if (!note) return new Response("Not found", { status: 404 });

  const size = note.bytes.length;
  const headers: Record<string, string> = {
    "Content-Type": note.mime,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "no-referrer",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new Response("Range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(note.bytes.slice(start, end + 1) as BodyInit, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(note.bytes as BodyInit, { headers: { ...headers, "Content-Length": String(size) } });
}
