import Link from "next/link";
import { Flag } from "lucide-react";
import { Badge } from "@/components/badges";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AccessDenied } from "@/components/access-denied";
import { formatDateTime } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { canModerate, listReports } from "@/modules/community";
import { ResolveReportForm } from "../forms";

const TARGET = { PROFILE: "Profile", POST: "Project", REVIEW: "Feedback", SESSION: "Session" } as const;

export default async function ReportsPage() {
  const { member } = await requireMember();
  if (!(await canModerate(member))) return <AccessDenied what="community reports" />;
  const reports = await listReports(member);
  const open = reports.filter((r) => r.status === "OPEN");
  const closed = reports.filter((r) => r.status !== "OPEN");

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Community" title="Reports" description="Profiles, projects, feedback and sessions members reported. Hide it when it breaks the code of conduct; dismiss the report otherwise." />
      <Card title={`Open (${open.length})`} bodyClassName={open.length ? "p-0" : undefined}>
        {open.length === 0 ? (
          <EmptyState icon={Flag} title="Nothing to review" />
        ) : (
          <ul className="divide-y divide-line">
            {open.map((r) => (
              <li key={r.id} className="space-y-3 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{TARGET[r.target_type]}</Badge>
                  {r.target_link && r.target_name ? (
                    <Link href={r.target_link} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                      {r.target_name}
                    </Link>
                  ) : (
                    <span className="font-medium">Something since removed</span>
                  )}
                  {r.target_hidden && <Badge tone="red">Hidden</Badge>}
                  <span className="text-xs text-muted">
                    reported by {r.reporter} · {formatDateTime(r.created_at)}
                  </span>
                </div>
                <p className="whitespace-pre-line break-words rounded-lg bg-surface-muted px-3 py-2">{r.reason}</p>
                <ResolveReportForm reportId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {closed.length > 0 && (
        <Card title="Handled" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {closed.map((r) => (
              <li key={r.id} className="space-y-1 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{TARGET[r.target_type]}</Badge>
                  <span className="font-medium">{r.target_name ?? "Something since removed"}</span>
                  <Badge tone={r.status === "RESOLVED" ? "red" : "gray"}>{r.status === "RESOLVED" ? "Hidden" : "Dismissed"}</Badge>
                  <span className="text-xs text-muted">
                    by {r.resolver} · {r.resolved_at && formatDateTime(r.resolved_at)}
                  </span>
                </div>
                <p className="text-muted">
                  “{r.reason}” — {r.resolution}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
