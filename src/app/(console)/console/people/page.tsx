import Link from "next/link";
import { Users } from "lucide-react";
import { inputClass } from "@/components/input-class";
import { Card, EmptyState, PageHeader, buttonClass, cx, table } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { listPeople } from "@/modules/platform";

export const metadata = { title: "People" };

// Phase 40: every login on the platform. Open someone to block or restore them or send a password link.

const STATUS = [
  { key: undefined, label: "All" },
  { key: "blocked", label: "Blocked" },
  { key: "unverified", label: "Email not confirmed" },
] as const;

export default async function ConsolePeople({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const me = (await getSignedIn())!;
  const params = await searchParams;
  const { people, more, page } = await listPeople(me, { q: params.q, status: params.status, page: Number(params.page) || 1 });
  const href = (patch: Record<string, string | undefined>) => `/console/people?${new URLSearchParams(Object.entries({ q: params.q, status: params.status, ...patch }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader title="People" description="Every login: community members and people in companies." />
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Status" className="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          {STATUS.map((s) => (
            <Link key={s.label} href={href({ status: s.key, page: undefined })} aria-current={params.status === s.key ? "page" : undefined} className={cx("rounded-md px-3 py-1.5", params.status === s.key ? "bg-surface font-medium shadow-xs" : "text-muted hover:text-fg")}>
              {s.label}
            </Link>
          ))}
        </nav>
        <form className="flex min-w-60 flex-1 gap-2" role="search">
          {params.status && <input type="hidden" name="status" value={params.status} />}
          <input name="q" defaultValue={params.q} placeholder="Name, email or profile address" aria-label="Search people" className={inputClass} />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
      </div>
      {people.length === 0 ? (
        <EmptyState icon={Users} title="Nobody matches" />
      ) : (
        <Card title={`Page ${page}`}>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Person</th>
                  <th className={cx(table.th, "text-right")}>Companies</th>
                  <th className={table.th}>Joined</th>
                  <th className={table.th}>Last seen</th>
                  <th className={table.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className={table.row}>
                    <td className={table.td}>
                      <Link href={`/console/people/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      {p.staff && <span className="ml-2 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-white">Staff</span>}
                      <div className="text-xs text-muted">
                        {p.email}
                        {p.handle && <> · @{p.handle}</>}
                      </div>
                    </td>
                    <td className={table.num}>{p.companies}</td>
                    <td className={table.td}>{formatDate(p.createdAt)}</td>
                    <td className={table.td}>{p.lastSeen ? formatDate(p.lastSeen) : "Never"}</td>
                    <td className={table.td}>
                      {!p.active ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">Blocked</span>
                      ) : !p.verified ? (
                        <span className="text-xs text-amber-700 dark:text-amber-400">Email not confirmed</span>
                      ) : (
                        <span className="text-xs text-muted">Active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-between text-sm">
            {page > 1 ? <Link href={href({ page: String(page - 1) })} className="hover:underline">← Newer</Link> : <span />}
            {more && <Link href={href({ page: String(page + 1) })} className="hover:underline">Older →</Link>}
          </div>
        </Card>
      )}
    </>
  );
}
