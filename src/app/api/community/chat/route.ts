import { getSignedIn } from "@/lib/session";
import { listChannels, openChannel, openThread } from "@/modules/community/chat";

// Phase 36: what an open chat page asks every few seconds. With `known` (the version it has), it
// gets a tiny "unchanged" answer unless something changed, to keep mobile data use low.
//   ?channel=<slug>&known=<version>   the channel's latest messages
//   ?thread=<id>&known=<version>      a thread
//   ?channels=1                       the channel list with unread counts

export async function GET(request: Request) {
  const me = await getSignedIn();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const known = params.get("known") ?? undefined;
  const headers = { "Cache-Control": "private, no-store" };
  if (params.get("channels")) return Response.json({ channels: await listChannels(me) }, { headers });
  const thread = params.get("thread");
  if (thread) {
    const view = await openThread(me, thread, known);
    if (!view) return Response.json({ error: "Not found" }, { status: 404, headers });
    return Response.json(view === "unchanged" ? { unchanged: true } : view, { headers });
  }
  const channel = params.get("channel") ?? "";
  const view = await openChannel(me, channel, { known, before: params.get("before") ?? undefined });
  if (!view) return Response.json({ error: "Not found" }, { status: 404, headers });
  return Response.json(view === "unchanged" ? { unchanged: true } : view, { headers });
}
