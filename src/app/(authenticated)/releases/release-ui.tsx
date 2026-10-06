import Link from "next/link";
import { Badge } from "@/components/badges";
import { cx, table } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { type Impact, type ReleaseRow, type ReleaseStatus, impactLabel, statusLabel } from "@/modules/releases";

// Phase 32: shared bits of the release screens.

const statusTone: Record<ReleaseStatus, "gray" | "blue" | "amber" | "green" | "red"> = {
  DRAFT: "gray",
  SUBMITTED: "amber",
  APPROVED: "blue",
  REJECTED: "red",
  DEPLOYED: "green",
  ROLLED_BACK: "red",
};
const impactTone: Record<Impact, "gray" | "amber" | "red"> = { LOW: "gray", MEDIUM: "amber", HIGH: "red" };

export function ReleaseStatusBadge({ status, emergency, decision }: { status: ReleaseStatus; emergency: boolean; decision: string | null }) {
  if (status === "DEPLOYED" && emergency && !decision) return <Badge tone="amber">Deployed, approval due</Badge>;
  if (status === "DEPLOYED" && decision === "REJECTED") return <Badge tone="red">Deployed, rejected afterwards</Badge>;
  return <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>;
}

export function ImpactBadge({ impact }: { impact: Impact }) {
  return <Badge tone={impactTone[impact]}>{impactLabel[impact]} impact</Badge>;
}

export function ReleaseTable({ rows, showProject }: { rows: ReleaseRow[]; showProject: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={table.table}>
        <thead className={table.head}>
          <tr>
            <th className={table.th}>Release</th>
            {showProject && <th className={table.th}>Project</th>}
            <th className={table.th}>Security</th>
            <th className={table.th}>Status</th>
            <th className={table.th}>Written by</th>
            <th className={table.th}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cx(table.row, "align-top")}>
              <td className={table.td}>
                <Link href={`/releases/${r.id}`} className="font-medium hover:underline">
                  {r.title}
                </Link>
                {r.versionLabel && <span className="ml-1.5 font-mono text-xs text-muted">{r.versionLabel}</span>}
                {r.emergency && (
                  <span className="ml-1.5">
                    <Badge tone="red">Emergency</Badge>
                  </span>
                )}
              </td>
              {showProject && (
                <td className={`${table.td} text-muted`}>
                  <Link href={`/projects/${r.projectId}?tab=releases`} className="hover:underline">
                    <span className="font-mono text-xs">{r.projectCode}</span> {r.projectName}
                  </Link>
                </td>
              )}
              <td className={table.td}>
                <ImpactBadge impact={r.securityImpact} />
                {r.securityReviewed && <span className="ml-1.5 text-xs text-emerald-700 dark:text-emerald-400">checked</span>}
              </td>
              <td className={table.td}>
                <ReleaseStatusBadge status={r.status} emergency={r.emergency} decision={r.decision} />
              </td>
              <td className={`${table.td} text-muted`}>{r.authorName}</td>
              <td className={`${table.td} text-muted`}>{formatDate(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
