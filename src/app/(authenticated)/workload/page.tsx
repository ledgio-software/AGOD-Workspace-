import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { roleLabel } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getWorkload } from "@/modules/reports/workload";

function loadClass(percent: number | null, open: number) {
  if (percent === null) return open > 0 ? "text-red-600" : "text-zinc-500";
  if (percent > 100) return "text-red-600 font-semibold";
  if (percent >= 80) return "text-amber-700 font-semibold";
  return "";
}

export default async function WorkloadPage() {
  const actor = await requireUser();
  if (!can(actor, "workload.view")) return <AccessDenied what="the workload view" />;
  const w = await getWorkload(actor);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Workload and capacity</h1>
        <p className="text-sm text-zinc-500">
          Open tasks on active projects per person. <strong>Planned</strong> is the estimated hours of tasks due in the next {w.windowDays} days
          or already overdue, compared with the person&apos;s weekly capacity (set by an Admin on the Team page). Tasks without an estimate
          count as 0 hours, so check the “No estimate” column.
        </p>
      </div>
      {w.unassigned > 0 && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {w.unassigned} open task{w.unassigned === 1 ? " has" : "s have"} nobody assigned.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Person</th>
              <th className="py-2 pr-3 text-right font-medium">Projects</th>
              <th className="py-2 pr-3 text-right font-medium">Open</th>
              <th className="py-2 pr-3 text-right font-medium">In progress</th>
              <th className="py-2 pr-3 text-right font-medium">Blocked</th>
              <th className="py-2 pr-3 text-right font-medium">Overdue</th>
              <th className="py-2 pr-3 text-right font-medium">Due in {w.windowDays} days</th>
              <th className="py-2 pr-3 text-right font-medium">No estimate</th>
              <th className="py-2 pr-3 text-right font-medium">Planned / capacity</th>
              <th className="py-2 text-right font-medium">Load</th>
            </tr>
          </thead>
          <tbody>
            {w.rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-3">
                  <Link href={`/team/${r.id}`} className="underline">
                    {r.name}
                  </Link>
                  <span className="text-zinc-500"> · {roleLabel[r.role as keyof typeof roleLabel]}</span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.activeProjects}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.open}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.inProgress}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${r.blocked ? "text-red-600" : ""}`}>{r.blocked}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${r.overdue ? "text-red-600" : ""}`}>{r.overdue}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.dueThisWeek}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.unestimated}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {r.plannedHours}h / {r.weeklyCapacityHours}h
                </td>
                <td className={`py-2 text-right tabular-nums ${loadClass(r.loadPercent, r.open)}`}>
                  {r.loadPercent === null ? (r.open ? "No capacity" : "—") : `${r.loadPercent}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
