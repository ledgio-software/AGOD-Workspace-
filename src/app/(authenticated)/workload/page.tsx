import Link from "next/link";
import { CircleSlash, Clock, ListChecks, UserX } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Avatar, Callout, Card, PageHeader, StatCard, compactTable as ct, cx, table } from "@/components/ui";
import { roleLabel } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getWorkload } from "@/modules/reports/workload";

/** A load meter: the fill moves from the accent to amber to red as planned work passes capacity. */
function LoadMeter({ percent, open }: { percent: number | null; open: number }) {
  if (percent === null) {
    return <span className={cx("text-xs", open > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted")}>{open ? "No capacity" : "—"}</span>;
  }
  const fill = percent > 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-brand-500";
  const text = percent > 100 ? "text-red-600 dark:text-red-400" : percent >= 80 ? "text-amber-700 dark:text-amber-400" : "text-fg";
  return (
    <span className="inline-flex items-center justify-end gap-2" title={`${percent}% of capacity`}>
      <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-line">
        <span className={cx("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${Math.min(percent, 100)}%` }} />
      </span>
      <span className={cx("w-10 text-right text-sm font-semibold tabular-nums", text)}>{percent}%</span>
    </span>
  );
}

export default async function WorkloadPage() {
  const actor = await requireUser();
  if (!can(actor, "workload.view")) return <AccessDenied what="the workload view" />;
  const w = await getWorkload(actor);
  const sum = (k: "open" | "blocked" | "overdue") => w.rows.reduce((s, r) => s + r[k], 0);
  const over = w.rows.filter((r) => (r.loadPercent ?? 0) > 100).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work"
        title="Workload and capacity"
        description={
          <>
            Open tasks on active projects per person. <strong>Planned</strong> is the estimated hours of tasks due in the next {w.windowDays} days or
            already overdue, compared with weekly capacity (set by an Admin on the Team page). Tasks without an estimate count as 0 hours, so check
            the “No estimate” column.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open tasks" value={sum("open")} icon={ListChecks} />
        <StatCard label="Blocked" value={sum("blocked")} icon={CircleSlash} tone={sum("blocked") ? "bad" : "default"} />
        <StatCard label="Overdue" value={sum("overdue")} icon={Clock} tone={sum("overdue") ? "warn" : "default"} />
        <StatCard label="Over capacity" value={over} hint="people above 100%" icon={UserX} tone={over ? "bad" : "good"} />
      </div>

      {w.unassigned > 0 && (
        <Callout tone="warn" icon={UserX}>
          {w.unassigned} open task{w.unassigned === 1 ? " has" : "s have"} nobody assigned.
        </Callout>
      )}

      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={ct.th}>Person</th>
                <th className={`${ct.th} text-right`}>Projects</th>
                <th className={`${ct.th} text-right`}>Open</th>
                <th className={`${ct.th} text-right`}>In progress</th>
                <th className={`${ct.th} text-right`}>Blocked</th>
                <th className={`${ct.th} text-right`}>Overdue</th>
                <th className={`${ct.th} text-right`}>Due in {w.windowDays} days</th>
                <th className={`${ct.th} text-right`}>No estimate</th>
                <th className={`${ct.th} text-right`}>Planned / capacity</th>
                <th className={`${ct.th} text-right`}>Load</th>
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r) => (
                <tr key={r.id} className={table.row}>
                  <td className={ct.td}>
                    <Link href={`/team/${r.id}`} className="flex items-center gap-2.5 whitespace-nowrap hover:text-brand-600">
                      <Avatar name={r.name} size="sm" />
                      <span>
                        <span className="block font-medium">{r.name}</span>
                        <span className="block text-xs text-muted">{roleLabel[r.role as keyof typeof roleLabel]}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={ct.num}>{r.activeProjects}</td>
                  <td className={ct.num}>{r.open}</td>
                  <td className={ct.num}>{r.inProgress}</td>
                  <td className={cx(ct.num, r.blocked > 0 && "font-semibold text-red-600 dark:text-red-400")}>{r.blocked}</td>
                  <td className={cx(ct.num, r.overdue > 0 && "font-semibold text-red-600 dark:text-red-400")}>{r.overdue}</td>
                  <td className={ct.num}>{r.dueThisWeek}</td>
                  <td className={cx(ct.num, r.unestimated > 0 && "text-amber-700 dark:text-amber-400")}>{r.unestimated}</td>
                  <td className={ct.num}>
                    {r.plannedHours}h <span className="text-muted">/ {r.weeklyCapacityHours}h</span>
                  </td>
                  <td className={ct.num}>
                    <LoadMeter percent={r.loadPercent} open={r.open} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
