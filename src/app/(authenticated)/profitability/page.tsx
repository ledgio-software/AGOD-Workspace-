import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { formatDateTime } from "@/lib/dates";
import { projectCategoryLabel, projectStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { PROJECT_CATEGORIES, getPayoutAging, getPayoutForecast, getProfitability, getUtilisation } from "@/modules/finance";

// Stage 3 profitability and business intelligence. Deliberately plain: the frontend will be
// redesigned; see docs/FRONTEND_CONTRACT.md for the data each section uses.

type Search = { view?: string; scope?: string; category?: string; month?: string };
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const signed = (minor: number) => <span className={minor < 0 ? "text-red-600" : ""}>{formatMoney(minor)}</span>;
const th = "py-2 pr-3 font-medium";
const td = "py-1 pr-3 tabular-nums";

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-zinc-500">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`${th} ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireUser();
  if (!can(actor, "finance.view")) return <AccessDenied what="profitability" />;
  const q = await searchParams;
  const view = q.view === "payouts" || q.view === "utilisation" ? q.view : "overview";
  const tabs = [
    ["overview", "Profit by project, client and type"],
    ["payouts", "Payout forecast and ageing"],
    ["utilisation", "Team utilisation"],
  ] as const;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Profitability</h1>
        <p className="text-sm text-zinc-500">
          Revenue is the value of external projects; internal projects are a cost. Payouts are planned team splits before approval and the
          approved amounts (after adjustments) after. Costs are the non-payout costs recorded on each project.
        </p>
      </div>
      <nav className="flex flex-wrap gap-2 text-sm">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/profitability?view=${key}`}
            className={`rounded-md border px-3 py-1 ${view === key ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {view === "overview" && <Overview q={q} />}
      {view === "payouts" && <Payouts />}
      {view === "utilisation" && <Utilisation month={q.month} />}
    </div>
  );
}

async function Overview({ q }: { q: Search }) {
  const actor = await requireUser();
  const d = await getProfitability(actor, { scope: q.scope as "all", category: q.category as "WEBSITE" });
  const exportQuery = new URLSearchParams({ scope: d.filters.scope, ...(d.filters.category ? { category: d.filters.category } : {}) });
  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="view" value="overview" />
        <label>
          <span className="block text-zinc-500">Projects</span>
          <select name="scope" defaultValue={d.filters.scope} className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="all">All (not cancelled)</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label>
          <span className="block text-zinc-500">Type</span>
          <select name="category" defaultValue={d.filters.category ?? ""} className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
            <option value="">All types</option>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {projectCategoryLabel[c]}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">Apply</button>
        <a href={`/profitability/export?${exportQuery}`} className="ml-auto underline">
          Export CSV
        </a>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["Revenue", formatMoney(d.totals.revenueMinor)],
            ["Contributor payouts", formatMoney(d.totals.payoutMinor)],
            ["Other costs", formatMoney(d.totals.costMinor)],
            ["Profit", formatMoney(d.totals.profitMinor)],
            ["Margin", pct(d.totals.marginPct)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">Projects ({d.projects.length})</h2>
        <Table head={["Project", "Revenue", "Payouts", "Costs / budget", "Est. profit", "Profit", "Margin"]}>
          {d.projects.map((p) => (
            <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-900">
              <td className="py-1 pr-3">
                <Link href={`/projects/${p.id}#finance`} className="underline">
                  {p.code}
                </Link>{" "}
                {p.name}
                <div className="text-xs text-zinc-500">
                  {projectCategoryLabel[p.category]} · {projectStatusLabel[p.status]} · {p.clientType === "INTERNAL" ? "Internal" : p.clientName}
                </div>
              </td>
              <td className={`${td} text-right`}>{formatMoney(p.revenueMinor)}</td>
              <td className={`${td} text-right`}>
                {formatMoney(p.approved ? p.committedPayoutMinor : p.plannedPayoutMinor)}
                <div className="text-xs text-zinc-500">{p.approved ? "approved" : "planned"}</div>
              </td>
              <td className={`${td} text-right`}>
                {formatMoney(p.actualCostMinor)} / {formatMoney(p.costBudgetMinor)}
                {p.costOverBudgetMinor > 0 && p.costBudgetMinor > 0 && <div className="text-xs text-red-600">over by {formatMoney(p.costOverBudgetMinor)}</div>}
              </td>
              <td className={`${td} text-right`}>{signed(p.estimatedProfitMinor)}</td>
              <td className={`${td} text-right`}>{signed(p.actualProfitMinor)}</td>
              <td className={`${td} text-right`}>{pct(p.actualMarginPct)}</td>
            </tr>
          ))}
        </Table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {(
          [
            ["By client", d.byClient, (n: string) => n],
            ["By project type", d.byCategory, (n: string) => projectCategoryLabel[n as keyof typeof projectCategoryLabel] ?? n],
          ] as const
        ).map(([title, groups, name]) => (
          <section key={title} className="space-y-2">
            <h2 className="font-semibold">{title}</h2>
            <Table head={["", "Projects", "Revenue", "Profit", "Margin"]}>
              {groups.map((g) => (
                <tr key={g.name} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1 pr-3">{name(g.name)}</td>
                  <td className={`${td} text-right`}>{g.projects}</td>
                  <td className={`${td} text-right`}>{formatMoney(g.revenueMinor)}</td>
                  <td className={`${td} text-right`}>{signed(g.profitMinor)}</td>
                  <td className={`${td} text-right`}>{pct(g.marginPct)}</td>
                </tr>
              ))}
            </Table>
          </section>
        ))}
      </div>
    </div>
  );
}

async function Payouts() {
  const actor = await requireUser();
  const [forecast, aging] = await Promise.all([getPayoutForecast(actor), getPayoutAging(actor)]);
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold">Payout forecast</h2>
        <p className="text-sm text-zinc-500">
          Owed now: approved and unpaid. Pending approval: the planned team splits of projects waiting for approval. In progress: planned splits in
          the month of the project&apos;s target date (this month if it has passed or is not set).
        </p>
        <Table head={["Month", "Owed now", "Pending approval", "In progress", "Total"]}>
          {forecast.rows.map((r) => (
            <tr key={r.month} className="border-t border-zinc-100 dark:border-zinc-900">
              <td className="py-1 pr-3">{r.month}</td>
              <td className={`${td} text-right`}>{formatMoney(r.owedNowMinor)}</td>
              <td className={`${td} text-right`}>{formatMoney(r.pendingApprovalMinor)}</td>
              <td className={`${td} text-right`}>{formatMoney(r.inProgressMinor)}</td>
              <td className={`${td} text-right font-semibold`}>{formatMoney(r.totalMinor)}</td>
            </tr>
          ))}
        </Table>
        {forecast.laterMinor > 0 && <p className="text-sm text-zinc-500">Later than shown: {formatMoney(forecast.laterMinor)}</p>}
        {forecast.pipeline.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">Projects in the forecast ({forecast.pipeline.length})</summary>
            <ul className="mt-2 space-y-1">
              {forecast.pipeline.map((p) => (
                <li key={p.id}>
                  {p.month} · <Link href={`/projects/${p.id}`} className="underline">{p.code}</Link> {p.name} · {projectStatusLabel[p.status]} ·{" "}
                  {formatMoney(p.plannedPayoutMinor)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Outstanding payouts by age</h2>
        <Table head={["Age since approval", "Payouts", "Unpaid"]}>
          {aging.buckets.map((b) => (
            <tr key={b.label} className="border-t border-zinc-100 dark:border-zinc-900">
              <td className="py-1 pr-3">{b.label}</td>
              <td className={`${td} text-right`}>{b.count}</td>
              <td className={`${td} text-right ${b.label === "Over 90 days" && b.remainingMinor > 0 ? "text-red-600" : ""}`}>{formatMoney(b.remainingMinor)}</td>
            </tr>
          ))}
        </Table>
        {aging.oldest.length > 0 && (
          <ul className="space-y-1 text-sm">
            {aging.oldest.map((o) => (
              <li key={o.id}>
                <Link href={`/payouts/${o.id}`} className="underline">
                  {o.projectCode} · {o.memberName}
                </Link>{" "}
                · {formatMoney(o.remainingMinor)} unpaid · approved {formatDateTime(o.approvedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function Utilisation({ month }: { month?: string }) {
  const actor = await requireUser();
  const u = await getUtilisation(actor, month);
  return (
    <section className="space-y-3">
      <form className="flex items-end gap-2 text-sm">
        <input type="hidden" name="view" value="utilisation" />
        <label>
          <span className="block text-zinc-500">Month</span>
          <input type="month" name="month" defaultValue={u.month} className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" />
        </label>
        <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700">Show</button>
      </form>
      <p className="text-sm text-zinc-500">
        Estimated hours of tasks completed in {u.month}, against weekly capacity × {u.weeks} weeks. Tasks without an estimate count as 0 hours.
      </p>
      <Table head={["Person", "Tasks done", "No estimate", "Hours done", "Capacity", "Utilisation"]}>
        {u.rows.map((r) => (
          <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-900">
            <td className="py-1 pr-3">
              <Link href={`/team/${r.id}`} className="underline">
                {r.name}
              </Link>
            </td>
            <td className={`${td} text-right`}>{r.tasksCompleted}</td>
            <td className={`${td} text-right`}>{r.unestimated}</td>
            <td className={`${td} text-right`}>{r.completedHours}h</td>
            <td className={`${td} text-right`}>{r.capacityHours}h</td>
            <td className={`${td} text-right`}>{pct(r.utilisationPct)}</td>
          </tr>
        ))}
      </Table>
    </section>
  );
}
