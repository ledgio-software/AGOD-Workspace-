import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { formatDate } from "@/lib/dates";
import { payoutStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listLedger } from "@/modules/ledger";
import { listActiveMembers, listProjects } from "@/modules/projects";

const selectClass = "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ memberId?: string; projectId?: string; status?: string }>;
}) {
  const actor = await requireUser();
  if (!can(actor, "payout.viewAll")) return <AccessDenied what="the payout ledger" />;
  const filters = await searchParams;
  const [ledger, members, projects] = await Promise.all([
    listLedger(actor, filters as never),
    listActiveMembers(actor),
    listProjects(actor),
  ]);
  const remaining = ledger.totals.owedMinor - ledger.totals.paidMinor;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Payout ledger</h1>
        <p className="text-sm text-zinc-500">
          Created only by approving a project. Amounts are fixed at approval; corrections are made with adjustments
          (Phase 4). Payment recording arrives in Phase 4.
        </p>
      </div>

      <form className="flex flex-wrap gap-2">
        <select name="memberId" defaultValue={filters.memberId ?? ""} className={selectClass}>
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select name="projectId" defaultValue={filters.projectId ?? ""} className={selectClass}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} {p.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className={selectClass}>
          <option value="">All statuses</option>
          {Object.entries(payoutStatusLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filter
        </button>
      </form>

      <dl className="grid grid-cols-3 gap-3 text-sm sm:max-w-xl">
        {[
          ["Owed (excl. voided)", ledger.totals.owedMinor],
          ["Paid", ledger.totals.paidMinor],
          ["Remaining", remaining],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(value as number)}</dd>
          </div>
        ))}
      </dl>

      {ledger.rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No ledger entries match. Entries appear when a project is approved.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Recipient</th>
                <th className="py-2 pr-4 font-medium">Owed</th>
                <th className="py-2 pr-4 font-medium">Paid</th>
                <th className="py-2 pr-4 font-medium">Remaining</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Approved</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((r) => (
                <tr key={r.id} className={`border-b border-zinc-100 dark:border-zinc-900 ${r.status === "VOIDED" ? "text-zinc-400" : ""}`}>
                  <td className="py-2 pr-4">
                    <Link href={`/projects/${r.projectId}`} className="hover:underline">
                      {r.projectCode}
                    </Link>{" "}
                    {r.projectName}
                  </td>
                  <td className="py-2 pr-4">{r.memberName}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatMoney(r.owedMinor, r.currency)}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatMoney(r.paidMinor, r.currency)}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {r.status === "VOIDED" ? "—" : formatMoney(r.owedMinor - r.paidMinor, r.currency)}
                  </td>
                  <td className="py-2 pr-4" title={r.notes ?? undefined}>
                    {payoutStatusLabel[r.status]}
                  </td>
                  <td className="py-2">
                    {formatDate(r.approvedAt)} by {r.approvedByName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
