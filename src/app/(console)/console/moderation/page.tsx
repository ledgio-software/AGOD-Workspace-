import Link from "next/link";
import { ExternalLink, Flag, ShieldCheck } from "lucide-react";
import { buttonClass, Card, EmptyState, PageHeader, cx, table } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { hiddenItems, listOrganizers, openReports } from "@/modules/platform";
import { organizerAction } from "../actions";
import { OrganizerForm } from "../forms";
import { RemoveOrganizerButton } from "./remove-organizer";

export const metadata = { title: "Moderation" };

// Phase 40: the whole community's moderation in one place: open reports, everything hidden, and
// who the organizers are. Reports are handled on the Reports page (staff count as organizers).

const TYPE_LABEL: Record<string, string> = {
  PROFILE: "Profile",
  POST: "Project",
  REVIEW: "Feedback",
  SESSION: "Session",
  LIBRARY: "Tool or prompt",
  JOB: "Job",
  TEAM: "Team post",
  CHAT: "Chat message",
  ARTICLE: "Article",
  ARTICLE_COMMENT: "Article comment",
};

export default async function ConsoleModeration() {
  const me = (await getSignedIn())!;
  const [reports, hidden, organizers] = await Promise.all([openReports(me), hiddenItems(me), listOrganizers(me)]);

  return (
    <>
      <PageHeader
        title="Moderation"
        description="Reports from members, everything organizers have hidden, and who can moderate. You count as an organizer everywhere, so you can hide or show anything on its own page."
        actions={
          <Link href="/community/reports" className={buttonClass("primary")}>
            <Flag className="size-4" aria-hidden /> Handle reports
          </Link>
        }
      />

      <Card title={`Open reports · ${reports.length}`} description="Hide or dismiss them on the Reports page.">
        {reports.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No open reports" />
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>What</th>
                  <th className={table.th}>Reason</th>
                  <th className={table.th}>Reported by</th>
                  <th className={table.th}>When</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className={table.row}>
                    <td className={table.td}>
                      <span className="text-xs text-muted">{TYPE_LABEL[r.target_type] ?? r.target_type}</span>
                      <div>{r.target_link ? <Link href={r.target_link} className="font-medium hover:underline">{r.target_name ?? "(deleted)"}</Link> : (r.target_name ?? "(deleted)")}</div>
                    </td>
                    <td className={cx(table.td, "max-w-sm")}>{r.reason}</td>
                    <td className={table.td}>{r.reporter}</td>
                    <td className={table.td}>{formatDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Hidden · ${hidden.length}`} description="Open an item and choose Show again to bring it back.">
        {hidden.length === 0 ? (
          <p className="text-sm text-muted">Nothing is hidden.</p>
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>What</th>
                  <th className={table.th}>Why</th>
                  <th className={table.th}>Hidden by</th>
                  <th className={table.th}>When</th>
                </tr>
              </thead>
              <tbody>
                {hidden.map((h) => (
                  <tr key={`${h.kind}-${h.id}`} className={table.row}>
                    <td className={table.td}>
                      <span className="text-xs text-muted">{h.kind}</span>
                      <div>
                        <Link href={h.link} className="inline-flex items-center gap-1 font-medium hover:underline">
                          {h.label} <ExternalLink className="size-3 text-muted" aria-hidden />
                        </Link>
                      </div>
                    </td>
                    <td className={cx(table.td, "max-w-xs text-muted")}>{h.reason ?? "—"}</td>
                    <td className={table.td}>{h.hiddenBy ?? "—"}</td>
                    <td className={table.td}>{formatDateTime(h.hiddenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Organizers" description="Organizers handle reports and hide or show content. Some come from settings (COMMUNITY_ORGANIZER_EMAILS, or staff in PLATFORM_ADMIN_EMAILS) and can only be changed there.">
        <div className="space-y-5">
          <ul className="divide-y divide-line text-sm">
            {organizers.map((o) => (
              <li key={o.email} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                <div>
                  <span className="font-medium">{o.name}</span> <span className="text-muted">· {o.email}</span>
                  {o.handle && (
                    <Link href={`/members/${o.handle}`} className="ml-1 text-muted hover:underline">
                      @{o.handle}
                    </Link>
                  )}
                </div>
                {o.via === "role" && o.handle ? (
                  <RemoveOrganizerButton action={organizerAction.bind(null, false)} handle={o.handle} name={o.name} />
                ) : (
                  <span className="text-xs text-muted">{o.via === "staff" ? "Staff (setting)" : "From settings"}</span>
                )}
              </li>
            ))}
          </ul>
          <OrganizerForm action={organizerAction.bind(null, true)} />
        </div>
      </Card>
    </>
  );
}
