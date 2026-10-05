import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { todayInOperatingZone } from "@/lib/dates";
import { listLedger } from "@/modules/ledger";
import { ledgerToCsv } from "@/modules/reports/csv";

// CSV export of the ledger with the page's filters (design doc section 10).
export async function GET(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in required", { status: 401 });
  if (!can(actor, "ledger.export")) return new Response("Not allowed", { status: 403 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { rows } = await listLedger(actor, params);
  return new Response(ledgerToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agod-ledger-${todayInOperatingZone()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
