import Link from "next/link";
import { FolderKanban, LayoutTemplate, Plus, Search } from "lucide-react";
import { HealthBadge, ProgressBar, ProjectStatusBadge } from "@/components/badges";
import { inputClass } from "@/components/form";
import { Avatar, ButtonLink, Card, EmptyState, PageHeader, buttonClass, table } from "@/components/ui";
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
  const filtered = Boolean(q || status);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work"
        title="Projects"
        description={canCreate ? "All the company's projects, their progress and health." : "Projects you are part of."}
        actions={
          canCreate && (
            <>
              <ButtonLink href="/templates">
                <LayoutTemplate className="size-4" aria-hidden /> Templates
              </ButtonLink>
              <ButtonLink href="/projects/new" variant="primary">
                <Plus className="size-4" aria-hidden /> New project
              </ButtonLink>
            </>
          )
        }
      />

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3" role="search">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search projects or clients" className={`${inputClass} pl-9`} />
          </div>
          <select name="status" defaultValue={status ?? ""} aria-label="Status" className={`${inputClass} w-auto`}>
            <option value="">All statuses</option>
            {Object.entries(projectStatusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass("secondary")}>
            Filter
          </button>
          {filtered && (
            <Link href="/projects" className="text-sm text-muted hover:text-fg">
              Clear
            </Link>
          )}
          <span className="ml-auto text-xs text-muted">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </span>
        </form>

        {projects.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={FolderKanban} title={filtered ? "No projects match these filters" : "No projects yet"}>
              {!filtered && canCreate ? "Create the first project to start tracking work and payouts." : undefined}
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Project</th>
                  <th className={table.th}>Client</th>
                  <th className={`${table.th} text-right`}>Value</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Progress</th>
                  <th className={table.th}>Owner</th>
                  <th className={table.th}>Target</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className={table.row}>
                    <td className={`${table.td} min-w-56`}>
                      <Link href={`/projects/${p.id}`} className="font-medium hover:text-brand-600">
                        {p.name}
                      </Link>
                      <div className="font-mono text-xs text-muted">{p.code}</div>
                    </td>
                    <td className={`${table.td} text-muted`}>{p.clientType === "INTERNAL" ? "Internal" : p.clientName}</td>
                    <td className={table.num}>{formatMoney(p.totalValueMinor, p.currency)}</td>
                    <td className={table.td}>
                      <div className="flex flex-col items-start gap-1">
                        <ProjectStatusBadge status={p.status} />
                        {p.health && <HealthBadge health={p.health} />}
                      </div>
                    </td>
                    <td className={table.td}>
                      <ProgressBar progress={p.progress} />
                    </td>
                    <td className={table.td}>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <Avatar name={p.ownerName} size="sm" />
                        {p.ownerName}
                      </span>
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>{formatCalendarDate(p.targetDate)}</td>
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
