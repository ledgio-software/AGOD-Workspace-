import Link from "next/link";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { inputClass } from "@/components/input-class";
import { Avatar, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { describeAuditAction } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { diffJson, listAuditEvents } from "@/modules/audit/query";
import { listActiveMembers, listProjects } from "@/modules/projects";

type Filters = { projectId?: string; actorId?: string; action?: string; from?: string; to?: string; page?: string };

function show(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "empty";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const actor = await requireUser();
  if (!can(actor, "audit.viewProject")) return <AccessDenied what="the audit log" />;
  const filters = await searchParams;
  const [result, members, projects] = await Promise.all([
    listAuditEvents(actor, filters),
    listActiveMembers(actor),
    listProjects(actor),
  ]);
  const query = (page: number) =>
    `?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>), page: String(page) })}`;
  const select = `${inputClass} w-auto max-w-56`;
  const filtered = Object.entries(filters).some(([k, v]) => k !== "page" && v);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team & admin"
        title="Audit log"
        description={
          <>
            Every material change, who made it, why, and what changed. Entries can never be edited or deleted.
            {result.scope === "projects" && " You see the history of projects you can view."}
          </>
        }
      />

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3">
          <select name="projectId" defaultValue={filters.projectId ?? ""} aria-label="Project" className={select}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
          <select name="actorId" defaultValue={filters.actorId ?? ""} aria-label="Person" className={select}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input name="action" defaultValue={filters.action} placeholder="Action, e.g. project.approved" className={`${inputClass} w-full sm:w-60`} />
          <label className="space-y-1 text-xs font-medium text-muted">
            <span className="block">From</span>
            <input type="date" name="from" defaultValue={filters.from} className={`${inputClass} w-auto`} />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted">
            <span className="block">To</span>
            <input type="date" name="to" defaultValue={filters.to} className={`${inputClass} w-auto`} />
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            Filter
          </button>
          {filtered && (
            <Link href="/audit" className="self-center text-sm text-muted hover:text-fg">
              Clear
            </Link>
          )}
        </form>

        {result.events.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={ScrollText} title="No events match" />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {result.events.map((e) => {
              const changes = diffJson(e.beforeJson, e.afterJson);
              return (
                <li key={e.id} className="flex gap-3 px-5 py-4 text-sm">
                  <Avatar name={e.actorName ?? "System"} size="sm" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p>
                        <span className="font-medium">{e.actorName ?? "System"}</span> <span className="text-muted">{describeAuditAction(e.action)}</span>
                        {e.projectCode && e.projectId && (
                          <>
                            {" · "}
                            <Link href={`/projects/${e.projectId}`} className="font-mono text-xs text-brand-600 hover:underline dark:text-brand-400">
                              {e.projectCode}
                            </Link>
                          </>
                        )}
                      </p>
                      <span className="whitespace-nowrap text-xs text-muted">{formatDateTime(e.createdAt)}</span>
                    </div>
                    <p className="font-mono text-[11px] text-muted">{e.action}</p>
                    {e.reason && <p className="rounded-lg bg-surface-muted px-3 py-1.5">Reason: “{e.reason}”</p>}
                    {changes.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted hover:text-fg">
                          {changes.length} field{changes.length === 1 ? "" : "s"} changed
                        </summary>
                        <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                          <table className="w-full text-left text-xs">
                            <tbody className="divide-y divide-line">
                              {changes.map((c) => (
                                <tr key={c.field} className="align-top">
                                  <td className="px-3 py-1.5 font-mono text-muted">{c.field}</td>
                                  <td className="max-w-md break-all px-3 py-1.5 text-red-700 line-through dark:text-red-400">{show(c.before)}</td>
                                  <td className="max-w-md break-all px-3 py-1.5 text-emerald-700 dark:text-emerald-400">{show(c.after)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {(result.page > 1 || result.hasMore) && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            {result.page > 1 ? (
              <Link href={`/audit${query(result.page - 1)}`} className={buttonClass("secondary", "sm")}>
                <ChevronLeft className="size-4" aria-hidden /> Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-muted">Page {result.page}</span>
            {result.hasMore ? (
              <Link href={`/audit${query(result.page + 1)}`} className={buttonClass("secondary", "sm")}>
                Older <ChevronRight className="size-4" aria-hidden />
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
