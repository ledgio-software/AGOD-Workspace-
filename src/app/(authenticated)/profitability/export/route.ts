import { todayInOperatingZone } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { getProfitability } from "@/modules/finance";
import { profitabilityToCsv } from "@/modules/reports/csv";

export async function GET(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in required", { status: 401 });
  if (!can(actor, "finance.view")) return new Response("Not allowed", { status: 403 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const data = await getProfitability(actor, params as { scope: "all" });
  return new Response(profitabilityToCsv(data.projects), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agod-profitability-${todayInOperatingZone()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
