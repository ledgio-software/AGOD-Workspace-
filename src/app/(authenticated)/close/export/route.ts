import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { getPeriodClose, periodMovements, periodSchema } from "@/modules/periods";
import { periodToCsv } from "@/modules/reports/csv";

// Month-close export (roadmap 2.9): every payment and adjustment in the month.
export async function GET(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in required", { status: 401 });
  if (!can(actor, "period.view") || !can(actor, "ledger.export")) return new Response("Not allowed", { status: 403 });

  const parsed = periodSchema.safeParse(new URL(request.url).searchParams.get("period"));
  if (!parsed.success) return new Response("Choose a month (YYYY-MM)", { status: 400 });
  const close = await getPeriodClose(actor, parsed.data);
  return new Response(periodToCsv(periodMovements(close)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agod-close-${parsed.data}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
