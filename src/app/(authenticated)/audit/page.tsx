import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { formatDateTime } from "@/lib/dates";
import { describeAuditAction } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { diffJson, listAuditEvents } from "@/modules/audit/query";
import { listActiveMembers, listProjects } from "@/modules/projects";

const inputClass = "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
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

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-zinc-500">
          Every material change, who made it, why, and what changed. Entries can never be edited or deleted.
          {result.scope === "projects" && " You see the history of projects you can view."}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <select name="projectId" defaultValue={filters.projectId ?? ""} className={inputClass}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} {p.name}
            </option>
          ))}
        </select>
        <select name="actorId" defaultValue={filters.actorId ?? ""} className={inputClass}>
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input name="action" defaultValue={filters.action} placeholder="Action, e.g. project.approved" className={inputClass} />
        <label className="text-xs text-zinc-500">
          From
          <input type="date" name="from" defaultValue={filters.from} className={`${inputClass} block`} />
        </label>
        <label className="text-xs text-zinc-500">
          To
          <input type="date" name="to" defaultValue={filters.to} className={`${inputClass} block`} />
        </label>
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filter
        </button>
      </form>

      {result.events.length === 0 ? (
        <p className="text-sm text-zinc-500">No events match.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
          {result.events.map((e) => {
            const changes = diffJson(e.beforeJson, e.afterJson);
            return (
              <li key={e.id} className="space-y-1 py-3 text-sm">
                <div>
                  <span className="text-zinc-500">{formatDateTime(e.createdAt)}</span> · <strong>{e.actorName ?? "System"}</strong>{" "}
                  {describeAuditAction(e.action)}
                  {e.projectCode && e.projectId && (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={`/projects/${e.projectId}`} className="hover:underline">
                        {e.projectCode}
                      </Link>
                    </>
                  )}
                  <span className="ml-2 font-mono text-xs text-zinc-400">{e.action}</span>
                </div>
                {e.reason && <div className="text-zinc-700 dark:text-zinc-300">Reason: “{e.reason}”</div>}
                {changes.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-zinc-500">{changes.length} field(s) changed</summary>
                    <table className="mt-1 text-xs">
                      <tbody>
                        {changes.map((c) => (
                          <tr key={c.field} className="align-top">
                            <td className="pr-3 font-mono text-zinc-500">{c.field}</td>
                            <td className="max-w-md break-all pr-3 text-red-700 line-through dark:text-red-400">{show(c.before)}</td>
                            <td className="max-w-md break-all text-green-800 dark:text-green-400">{show(c.after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-4 text-sm">
        {result.page > 1 && <Link href={`/audit${query(result.page - 1)}`} className="underline">← Newer</Link>}
        {result.hasMore && <Link href={`/audit${query(result.page + 1)}`} className="underline">Older →</Link>}
      </div>
    </div>
  );
}
