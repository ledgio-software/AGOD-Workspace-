import Link from "next/link";
import { HealthBadge, ProgressBar, ProjectStatusBadge } from "@/components/badges";
import { formatCalendarDate } from "@/lib/dates";
import { projectStatusLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listProjects } from "@/modules/projects";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const actor = await requireUser();
  const { q, status } = await searchParams;
  const projects = await listProjects(actor, { q, status: status as never });
  const canCreate = can(actor, "project.create");

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-zinc-500">
            {canCreate ? "All AGOD projects." : "Projects you are part of."}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/projects/new"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            New project
          </Link>
        )}
      </div>

      <form className="flex flex-wrap gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, code or client"
          className="w-64 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        >
          <option value="">All statuses</option>
          {Object.entries(projectStatusLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filter
        </button>
      </form>

      {projects.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {q || status ? "No projects match these filters." : "No projects yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Client</th>
                <th className="py-2 pr-4 font-medium">Value</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Health</th>
                <th className="py-2 pr-4 font-medium">Progress</th>
                <th className="py-2 pr-4 font-medium">Owner</th>
                <th className="py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-3 pr-4">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-zinc-500">{p.code}</div>
                  </td>
                  <td className="py-3 pr-4">{p.clientType === "INTERNAL" ? "Internal" : p.clientName}</td>
                  <td className="py-3 pr-4 tabular-nums">{formatMoney(p.totalValueMinor, p.currency)}</td>
                  <td className="py-3 pr-4">
                    <ProjectStatusBadge status={p.status} />
                  </td>
                  <td className="py-3 pr-4">
                    <HealthBadge health={p.health} />
                  </td>
                  <td className="py-3 pr-4">
                    <ProgressBar progress={p.progress} />
                  </td>
                  <td className="py-3 pr-4">{p.ownerName}</td>
                  <td className="py-3">{formatCalendarDate(p.targetDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
