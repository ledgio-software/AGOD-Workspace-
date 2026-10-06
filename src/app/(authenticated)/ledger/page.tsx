import Link from "next/link";
import { Banknote, Download, FileSpreadsheet, Hourglass, Scale, Wallet } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { PayoutStatusBadge } from "@/components/badges";
import { inputClass } from "@/components/input-class";
import { Avatar, ButtonLink, Card, EmptyState, PageHeader, StatCard, buttonClass, cx, table } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { payoutStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listLedger } from "@/modules/ledger";
import { listActiveMembers, listProjects } from "@/modules/projects";

type Filters = { memberId?: string; projectId?: string; status?: string; from?: string; to?: string };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await requireUser();
  if (!can(actor, "payout.viewAll")) return <AccessDenied what="the payout ledger" />;
  const filters = await searchParams;
  const [ledger, members, projects] = await Promise.all([
    listLedger(actor, filters as never),
    listActiveMembers(actor),
    listProjects(actor),
  ]);
  const exportQuery = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  const filtered = Object.values(filters).some(Boolean);
  const select = `${inputClass} w-auto max-w-56`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Payout ledger"
        description="Created only by approving a project. Statuses follow the recorded payments and adjustments."
        actions={
          <>
            <ButtonLink href="/reconcile">
              <FileSpreadsheet className="size-4" aria-hidden /> Reconcile with a spreadsheet
            </ButtonLink>
            {can(actor, "ledger.export") && (
              <a href={`/ledger/export${exportQuery ? `?${exportQuery}` : ""}`} className={buttonClass("secondary")}>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Owed (excl. voided)" value={formatMoney(ledger.totals.owedMinor)} icon={Wallet} />
        <StatCard label="Adjustments (net)" value={formatMoney(ledger.totals.adjustmentsMinor)} icon={Scale} />
        <StatCard label="Paid" value={formatMoney(ledger.totals.paidMinor)} icon={Banknote} tone="good" />
        <StatCard label="Remaining" value={formatMoney(ledger.totals.remainingMinor)} icon={Hourglass} tone={ledger.totals.remainingMinor > 0 ? "warn" : "good"} />
      </div>

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3">
          <select name="memberId" defaultValue={filters.memberId ?? ""} aria-label="Member" className={select}>
            <option value="">All members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select name="projectId" defaultValue={filters.projectId ?? ""} aria-label="Project" className={select}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={filters.status ?? ""} aria-label="Status" className={select}>
            <option value="">All statuses</option>
            {Object.entries(payoutStatusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="space-y-1 text-xs font-medium text-muted">
            <span className="block">Approved from</span>
            <input type="date" name="from" defaultValue={filters.from} className={`${inputClass} w-auto`} />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted">
            <span className="block">to</span>
            <input type="date" name="to" defaultValue={filters.to} className={`${inputClass} w-auto`} />
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            Filter
          </button>
          {filtered && (
            <Link href="/ledger" className="self-center text-sm text-muted hover:text-fg">
              Clear
            </Link>
          )}
          <span className="ml-auto self-center text-xs text-muted">{ledger.rows.length} entries</span>
        </form>

        {ledger.rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Wallet} title="No ledger entries match">
              Entries appear when a project is approved.
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Project</th>
                  <th className={table.th}>Recipient</th>
                  <th className={`${table.th} text-right`}>Owed</th>
                  <th className={`${table.th} text-right`}>Paid</th>
                  <th className={`${table.th} text-right`}>Remaining</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Approved</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r) => (
                  <tr key={r.id} className={cx(table.row, r.status === "VOIDED" && "text-muted")}>
                    <td className={`${table.td} min-w-52`}>
                      <Link href={`/projects/${r.projectId}`} className="font-medium hover:text-brand-600">
                        {r.projectName}
                      </Link>
                      <div className="font-mono text-xs text-muted">{r.projectCode}</div>
                    </td>
                    <td className={table.td}>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <Avatar name={r.memberName} size="sm" />
                        <span>
                          {r.memberName}
                          <span className="block text-xs text-muted">{r.roleOnProject}</span>
                        </span>
                      </span>
                    </td>
                    <td className={table.num}>
                      {formatMoney(r.effectiveOwedMinor, r.currency)}
                      {r.adjustmentsMinor !== 0 && (
                        <div className="text-xs text-muted">
                          approved {formatMoney(r.originalMinor, r.currency)}, adjusted {formatMoney(r.adjustmentsMinor, r.currency)}
                        </div>
                      )}
                    </td>
                    <td className={table.num}>{formatMoney(r.paidMinor, r.currency)}</td>
                    <td className={`${table.num} font-medium`}>{r.status === "VOIDED" ? "—" : formatMoney(r.remainingMinor, r.currency)}</td>
                    <td className={table.td}>
                      <Link href={`/payouts/${r.id}`} title={r.notes ?? "Open payout"} className="inline-flex items-center gap-1.5 hover:opacity-80">
                        <PayoutStatusBadge status={r.status} />
                        <span className="text-xs font-medium text-brand-600 dark:text-brand-400">Open</span>
                      </Link>
                    </td>
                    <td className={`${table.td} whitespace-nowrap text-muted`}>
                      {formatDate(r.approvedAt)}
                      <div className="text-xs">by {r.approvedByName}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
