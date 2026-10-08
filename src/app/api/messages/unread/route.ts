import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { unreadMessageCount } from "@/modules/messages";

// Phase 30: how many messages the signed-in person hasn't read, for the message icon (polled).

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ count: 0 }, { status: 401 });
  return NextResponse.json({ count: await unreadMessageCount(user) }, { headers: { "Cache-Control": "no-store" } });
}
