import Link from "next/link";
import { Banknote, Clock, Download, Gauge, Hourglass, Percent, Receipt, TrendingUp, Wallet } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/badges";
import { BarList, StackedColumns, compactMoney } from "@/components/charts";
import { inputClass } from "@/components/form";
import { Avatar, Card, EmptyState, PageHeader, StatCard, TabNav, buttonClass, compactTable as ct, cx, table } from "@/components/ui";
import { formatCalendarDate, formatDateTime } from "@/lib/dates";
import { projectCategoryLabel, projectStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { PROJECT_CATEGORIES, getPayoutAging, getPayoutForecast, getProfitability, getUtilisation } from "@/modules/finance";

type Search = { view?: string; scope?: string; category?: string; month?: string };
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const Signed = ({ minor }: { minor: number }) => (
  <span className={minor < 0 ? "text-red-600 dark:text-red-400" : ""}>{formatMoney(minor)}</span>
);
const monthLabel = (ym: string, style: "short" | "long" = "short") =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" });

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireUser();
  if (!can(actor, "finance.view")) return <AccessDenied what="profitability" />;
  const q = await searchParams;
  const view = q.view === "payouts" || q.view === "utilisation" ? q.view : "overview";
  const tabs = [
    ["overview", "Profit by project, client and type", TrendingUp],
    ["payouts", "Payout forecast and ageing", Wallet],
    ["utilisation", "Team utilisation", Gauge],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Profitability"
        description="Revenue is the value of external projects; internal projects are a cost. Payouts are the planned team splits before approval and the approved amounts (after adjustments) after. Costs are the non-payout costs recorded on each project."
      />
      <TabNav label="Profitability views" items={tabs.map(([key, label, icon]) => ({ href: `/profitability?view=${key}`, label, icon, active: view === key }))} />
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
  const typeName = (n: string) => projectCategoryLabel[n as keyof typeof projectCategoryLabel] ?? n;

  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs">
        <input type="hidden" name="view" value="overview" />
        <label className="space-y-1.5 text-xs font-medium text-muted">
          <span className="block">Projects</span>
          <select name="scope" defaultValue={d.filters.scope} className={`${inputClass} w-auto`}>
            <option value="all">All (not cancelled)</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted">
          <span className="block">Type</span>
          <select name="category" defaultValue={d.filters.category ?? ""} className={`${inputClass} w-auto`}>
            <option value="">All types</option>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {projectCategoryLabel[c]}
              </option>
            ))}
          </select>
        </label>
        <button className={buttonClass("secondary")}>Apply</button>
        <a href={`/profitability/export?${exportQuery}`} className={cx(buttonClass("ghost"), "ml-auto")}>
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Revenue" value={formatMoney(d.totals.revenueMinor)} icon={Banknote} />
        <StatCard label="Contributor payouts" value={formatMoney(d.totals.payoutMinor)} icon={Wallet} />
        <StatCard label="Other costs" value={formatMoney(d.totals.costMinor)} icon={Receipt} />
        <StatCard label="Profit" value={formatMoney(d.totals.profitMinor)} icon={TrendingUp} tone={d.totals.profitMinor < 0 ? "bad" : "good"} />
        <StatCard label="Margin" value={pct(d.totals.marginPct)} icon={Percent} tone={(d.totals.marginPct ?? 0) < 0 ? "bad" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profit by project type" description="Revenue minus payouts and other costs">
          {d.byCategory.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No projects in this view" />
          ) : (
            <BarList
              negativeLabel="Loss"
              items={d.byCategory.map((g) => ({
                key: g.name,
                label: typeName(g.name),
                value: g.profitMinor,
                display: formatMoney(g.profitMinor),
                note: `${g.projects} project${g.projects === 1 ? "" : "s"}, margin ${pct(g.marginPct)}`,
              }))}
            />
          )}
        </Card>
        <Card title="Profit by client" description="Internal projects earn no revenue, so they show as a cost">
          {d.byClient.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No projects in this view" />
          ) : (
            <BarList
              negativeLabel="Loss"
              items={d.byClient.map((g) => ({
                key: g.name,
                label: g.name,
                value: g.profitMinor,
                display: formatMoney(g.profitMinor),
                note: `${g.projects} project${g.projects === 1 ? "" : "s"}, margin ${pct(g.marginPct)}`,
              }))}
            />
          )}
        </Card>
      </div>

      <Card title={`Projects (${d.projects.length})`} bodyClassName="p-0">
        {d.projects.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No projects match these filters" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={ct.th}>Project</th>
                  <th className={`${ct.th} text-right`}>Revenue</th>
                  <th className={`${ct.th} text-right`}>Payouts</th>
                  <th className={`${ct.th} text-right`}>Costs / budget</th>
                  <th className={`${ct.th} text-right`}>Est. profit</th>
                  <th className={`${ct.th} text-right`}>Profit</th>
                  <th className={`${ct.th} text-right`}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {d.projects.map((p) => (
                  <tr key={p.id} className={table.row}>
                    <td className={`${ct.td} min-w-60`}>
                      <Link href={`/projects/${p.id}?tab=team#finance`} className="font-medium hover:text-brand-600">
                        {p.name}
                      </Link>
                      <div className="text-xs text-muted">
                        <span className="font-mono">{p.code}</span> · {projectCategoryLabel[p.category]} · {projectStatusLabel[p.status]} ·{" "}
                        {p.clientType === "INTERNAL" ? "Internal" : p.clientName}
                      </div>
                    </td>
                    <td className={ct.num}>{formatMoney(p.revenueMinor)}</td>
                    <td className={ct.num}>
                      {formatMoney(p.approved ? p.committedPayoutMinor : p.plannedPayoutMinor)}
                      <div className="text-xs text-muted">{p.approved ? "approved" : "planned"}</div>
                    </td>
                    <td className={ct.num}>
                      {formatMoney(p.actualCostMinor)} <span className="text-muted">/ {formatMoney(p.costBudgetMinor)}</span>
                      {p.costOverBudgetMinor > 0 && p.costBudgetMinor > 0 && (
                        <div className="text-xs text-red-600 dark:text-red-400">over by {formatMoney(p.costOverBudgetMinor)}</div>
                      )}
                    </td>
                    <td className={ct.num}>
                      <Signed minor={p.estimatedProfitMinor} />
                    </td>
                    <td className={`${ct.num} font-medium`}>
                      <Signed minor={p.actualProfitMinor} />
                    </td>
                    <td className={ct.num}>{pct(p.actualMarginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {(
          [
            ["By client", d.byClient, (n: string) => n],
            ["By project type", d.byCategory, typeName],
          ] as const
        ).map(([title, groups, name]) => (
          <Card key={title} title={title} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className={table.table}>
                <thead className={table.head}>
                  <tr>
                    <th className={ct.th}>{title === "By client" ? "Client" : "Type"}</th>
                    <th className={`${ct.th} text-right`}>Projects</th>
                    <th className={`${ct.th} text-right`}>Revenue</th>
                    <th className={`${ct.th} text-right`}>Profit</th>
                    <th className={`${ct.th} text-right`}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.name} className={table.row}>
                      <td className={ct.td}>{name(g.name)}</td>
                      <td className={ct.num}>{g.projects}</td>
                      <td className={ct.num}>{formatMoney(g.revenueMinor)}</td>
                      <td className={ct.num}>
                        <Signed minor={g.profitMinor} />
                      </td>
                      <td className={ct.num}>{pct(g.marginPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

async function Payouts() {
  const actor = await requireUser();
  const [forecast, aging] = await Promise.all([getPayoutForecast(actor), getPayoutAging(actor)]);
  const forecastTotal = forecast.rows.reduce((s, r) => s + r.totalMinor, 0) + forecast.laterMinor;
  const unpaid = aging.buckets.reduce((s, b) => s + b.remainingMinor, 0);
  const overdue = aging.buckets.find((b) => b.label === "Over 90 days");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Owed now" value={formatMoney(forecast.owedNowMinor)} hint="Approved, not yet paid" icon={Wallet} tone={forecast.owedNowMinor ? "warn" : "good"} />
        <StatCard label="Forecast, next 6 months" value={formatMoney(forecastTotal)} hint="Owed, awaiting approval and in progress" icon={TrendingUp} />
        <StatCard label="Projects in the pipeline" value={forecast.pipeline.length} hint="Not yet approved" icon={Hourglass} />
        <StatCard
          label="Unpaid over 90 days"
          value={formatMoney(overdue?.remainingMinor ?? 0)}
          hint={`${overdue?.count ?? 0} payout(s)`}
          icon={Clock}
          tone={overdue && overdue.remainingMinor > 0 ? "bad" : "good"}
        />
      </div>

      <Card
        title="Payout forecast"
        description="Owed now: approved and unpaid. Awaiting approval: planned splits of projects waiting for approval. In progress: planned splits in the month of the project's target date (this month if it has passed or isn't set)."
      >
        {forecastTotal === 0 ? (
          <EmptyState icon={Wallet} title="Nothing to forecast" />
        ) : (
          <div className="space-y-6">
            <StackedColumns
              series={[
                { key: "owed", label: "Owed now", className: "bg-series-1" },
                { key: "pending", label: "Awaiting approval", className: "bg-series-2" },
                { key: "progress", label: "In progress", className: "bg-series-3" },
              ]}
              data={forecast.rows.map((r) => ({
                key: r.month,
                label: monthLabel(r.month),
                fullLabel: monthLabel(r.month, "long"),
                values: { owed: r.owedNowMinor, pending: r.pendingApprovalMinor, progress: r.inProgressMinor },
              }))}
              format={(v) => formatMoney(v)}
              axisFormat={(v) => compactMoney(v)}
            />
            <div className="-mx-5 -mb-4 overflow-x-auto border-t border-line">
              <table className={table.table}>
                <thead className={table.head}>
                  <tr>
                    <th className={table.th}>Month</th>
                    <th className={`${table.th} text-right`}>Owed now</th>
                    <th className={`${table.th} text-right`}>Awaiting approval</th>
                    <th className={`${table.th} text-right`}>In progress</th>
                    <th className={`${table.th} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.rows.map((r) => (
                    <tr key={r.month} className={table.row}>
                      <td className={table.td}>{monthLabel(r.month, "long")}</td>
                      <td className={table.num}>{formatMoney(r.owedNowMinor)}</td>
                      <td className={table.num}>{formatMoney(r.pendingApprovalMinor)}</td>
                      <td className={table.num}>{formatMoney(r.inProgressMinor)}</td>
                      <td className={`${table.num} font-semibold`}>{formatMoney(r.totalMinor)}</td>
                    </tr>
                  ))}
                  {forecast.laterMinor > 0 && (
                    <tr className={table.row}>
                      <td className={`${table.td} text-muted`} colSpan={4}>
                        Later than shown
                      </td>
                      <td className={`${table.num} font-semibold`}>{formatMoney(forecast.laterMinor)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {forecast.pipeline.length > 0 && (
        <Card title={`Projects in the forecast (${forecast.pipeline.length})`} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Project</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Expected</th>
                  <th className={`${table.th} text-right`}>Planned payouts</th>
                </tr>
              </thead>
              <tbody>
                {forecast.pipeline.map((p) => (
                  <tr key={p.id} className={table.row}>
                    <td className={table.td}>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:text-brand-600">
                        {p.name}
                      </Link>
                      <div className="font-mono text-xs text-muted">{p.code}</div>
                    </td>
                    <td className={table.td}>
                      <Badge tone={p.status === "PENDING_APPROVAL" ? "amber" : "blue"}>{projectStatusLabel[p.status]}</Badge>
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>
                      {monthLabel(p.month, "long")}
                      {p.targetDate && <div className="text-xs text-muted">target {formatCalendarDate(p.targetDate)}</div>}
                    </td>
                    <td className={table.num}>{formatMoney(p.plannedPayoutMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Unpaid payouts by age" description={`Days since approval · ${formatMoney(unpaid)} unpaid in total`}>
          {unpaid === 0 ? (
            <EmptyState icon={Wallet} title="Everything approved has been paid" />
          ) : (
            <BarList
              items={aging.buckets.map((b) => ({
                key: b.label,
                label: b.label,
                value: b.remainingMinor,
                display: formatMoney(b.remainingMinor),
                note: `${b.count} payout${b.count === 1 ? "" : "s"}`,
              }))}
            />
          )}
        </Card>
        <Card title="Oldest unpaid">
          {aging.oldest.length === 0 ? (
            <EmptyState icon={Wallet} title="Nothing outstanding" />
          ) : (
            <ul className="-my-2.5 divide-y divide-line">
              {aging.oldest.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/payouts/${o.id}`} className="flex min-w-0 items-center gap-2.5 hover:text-brand-600">
                    <Avatar name={o.memberName} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{o.memberName}</span>
                      <span className="block text-xs text-muted">
                        {o.projectCode} · approved {formatDateTime(o.approvedAt)}
                      </span>
                    </span>
                  </Link>
                  <span className="shrink-0 font-medium tabular-nums">{formatMoney(o.remainingMinor)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

async function Utilisation({ month }: { month?: string }) {
  const actor = await requireUser();
  const u = await getUtilisation(actor, month);
  const withCapacity = u.rows.filter((r) => r.utilisationPct !== null);
  const avg = withCapacity.length ? Math.round(withCapacity.reduce((s, r) => s + (r.utilisationPct ?? 0), 0) / withCapacity.length) : null;
  const hours = u.rows.reduce((s, r) => s + r.completedHours, 0);
  const capacity = u.rows.reduce((s, r) => s + r.capacityHours, 0);

  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs">
        <input type="hidden" name="view" value="utilisation" />
        <label className="space-y-1.5 text-xs font-medium text-muted">
          <span className="block">Month</span>
          <input type="month" name="month" defaultValue={u.month} className={`${inputClass} w-auto`} />
        </label>
        <button className={buttonClass("secondary")}>Show</button>
        <p className="text-xs text-muted sm:ml-auto sm:max-w-md sm:text-right">
          Estimated hours of tasks completed in {monthLabel(u.month, "long")}, against weekly capacity × {u.weeks} weeks. Tasks without an estimate
          count as 0 hours.
        </p>
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Average utilisation" value={avg === null ? "—" : `${avg}%`} icon={Gauge} />
        <StatCard label="Hours completed" value={`${hours}h`} icon={Clock} />
        <StatCard label="Team capacity" value={`${capacity}h`} icon={Hourglass} />
      </div>

      <Card title="Utilisation by person" description="Completed estimated hours as a share of capacity">
        {withCapacity.length === 0 ? (
          <EmptyState icon={Gauge} title="No capacity set" >
            Set weekly capacity for people on the Team page to see utilisation.
          </EmptyState>
        ) : (
          <BarList
            reference={100}
            referenceLabel="100% of capacity"
            max={Math.max(120, ...withCapacity.map((r) => Math.min(r.utilisationPct ?? 0, 200)))}
            items={withCapacity.map((r) => ({
              key: r.id,
              label: r.name,
              value: Math.min(r.utilisationPct ?? 0, 200),
              display: `${r.utilisationPct}%`,
              note: `${r.completedHours}h of ${r.capacityHours}h`,
            }))}
          />
        )}
      </Card>

      <Card title="Details" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Person</th>
                <th className={`${table.th} text-right`}>Tasks done</th>
                <th className={`${table.th} text-right`}>No estimate</th>
                <th className={`${table.th} text-right`}>Hours done</th>
                <th className={`${table.th} text-right`}>Capacity</th>
                <th className={`${table.th} text-right`}>Utilisation</th>
              </tr>
            </thead>
            <tbody>
              {u.rows.map((r) => (
                <tr key={r.id} className={table.row}>
                  <td className={table.td}>
                    <Link href={`/team/${r.id}`} className="inline-flex items-center gap-2 hover:text-brand-600">
                      <Avatar name={r.name} size="sm" />
                      {r.name}
                    </Link>
                  </td>
                  <td className={table.num}>{r.tasksCompleted}</td>
                  <td className={table.num}>{r.unestimated}</td>
                  <td className={table.num}>{r.completedHours}h</td>
                  <td className={table.num}>{r.capacityHours}h</td>
                  <td className={`${table.num} font-medium`}>{pct(r.utilisationPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
