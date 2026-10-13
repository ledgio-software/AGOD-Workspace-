import Link from "next/link";
import { Building2 } from "lucide-react";
import { inputClass } from "@/components/input-class";
import { Card, EmptyState, PageHeader, buttonClass, cx, table } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { listCompanies } from "@/modules/platform";

export const metadata = { title: "Companies" };

// Phase 40: every company as a summary. Suspend or restore one from its page.

const STATUS = [
  { key: undefined, label: "All" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
] as const;

export default async function ConsoleCompanies({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const me = (await getSignedIn())!;
  const params = await searchParams;
  const companies = await listCompanies(me, params);
  const href = (status?: string) => `/console/companies?${new URLSearchParams(Object.entries({ q: params.q, status }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader title="Companies" description="Every company workspace: who's in it, how many projects, when it was last used. Their projects, clients and money stay private to them." />
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Status" className="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          {STATUS.map((s) => (
            <Link key={s.label} href={href(s.key)} aria-current={params.status === s.key ? "page" : undefined} className={cx("rounded-md px-3 py-1.5", params.status === s.key ? "bg-surface font-medium shadow-xs" : "text-muted hover:text-fg")}>
              {s.label}
            </Link>
          ))}
        </nav>
        <form className="flex min-w-60 flex-1 gap-2" role="search">
          {params.status && <input type="hidden" name="status" value={params.status} />}
          <input name="q" defaultValue={params.q} placeholder="Company name or address" aria-label="Search companies" className={inputClass} />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
      </div>
      {companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies match" />
      ) : (
        <Card title={`${companies.length} ${companies.length === 1 ? "company" : "companies"}`}>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Company</th>
                  <th className={table.th}>Kind</th>
                  <th className={cx(table.th, "text-right")}>People</th>
                  <th className={cx(table.th, "text-right")}>Projects</th>
                  <th className={table.th}>Created</th>
                  <th className={table.th}>Last used</th>
                  <th className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className={table.row}>
                    <td className={table.td}>
                      <Link href={`/console/companies/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted">{c.slug}</div>
                    </td>
                    <td className={table.td}>{c.teamType === "FINTECH" ? "Fintech" : c.teamType === "SOFTWARE" ? "Software" : "Other"}</td>
                    <td className={table.num}>{c.members}</td>
                    <td className={table.num}>{c.projects}</td>
                    <td className={table.td}>{formatDate(c.createdAt)}</td>
                    <td className={table.td}>{c.lastActivity ? formatDate(c.lastActivity) : "Never"}</td>
                    <td className={table.td}>
                      {c.suspendedAt ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">Suspended</span> : <span className="text-xs text-muted">Active</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
