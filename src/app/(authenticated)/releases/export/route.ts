import { z } from "zod";
import { can } from "@/lib/permissions";
import { getRequestMeta } from "@/lib/request-meta";
import { getCurrentUser } from "@/lib/session";
import { releaseEvidenceCsv } from "@/modules/releases";

// Phase 32: release evidence for auditors (Admins with the company settings group).
export async function GET(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in required", { status: 401 });
  if (!can(actor, "audit.viewAll")) return new Response("Not allowed", { status: 403 });
  const params = new URL(request.url).searchParams;
  const range = { from: params.get("from") ?? "", to: params.get("to") ?? "" };
  try {
    const csv = await releaseEvidenceCsv(actor, range, await getRequestMeta());
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="agod-releases-${range.from}-to-${range.to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return new Response(error.issues.map((i) => i.message).join(" "), { status: 400 });
    throw error;
  }
}
