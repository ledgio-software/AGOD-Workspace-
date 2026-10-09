import { formatDateTime } from "@/lib/dates";
import type { AuditRow } from "@/modules/platform";

// Phase 40: entries of the back-office log, in words.

export const ACTION_LABEL: Record<string, string> = {
  COMPANY_SUSPENDED: "Suspended the company",
  COMPANY_RESTORED: "Restored the company",
  LOGIN_BLOCKED: "Blocked the login",
  LOGIN_RESTORED: "Restored the login",
  RESET_LINK_SENT: "Sent a password link",
  ORGANIZER_ADDED: "Made an organizer",
  ORGANIZER_REMOVED: "Removed as organizer",
};

export function AuditList({ rows, empty, showTarget = false }: { rows: AuditRow[]; empty: string; showTarget?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3 text-sm">
      {rows.map((r) => (
        <li key={r.id}>
          <p>
            <span className="font-medium">{r.actor}</span> · {ACTION_LABEL[r.action] ?? r.action}
            {showTarget && <> · {r.targetLabel}</>}
          </p>
          {r.reason && <p className="text-muted">“{r.reason}”</p>}
          <p className="text-xs text-muted">{formatDateTime(r.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}
