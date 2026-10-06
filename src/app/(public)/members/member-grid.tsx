import Link from "next/link";
import { Badge } from "@/components/badges";
import { Avatar, cx } from "@/components/ui";
import type { MemberCard } from "@/modules/community";

/** Member cards for the directory and the community home. */
export function MemberGrid({ members, compact = false }: { members: MemberCard[]; compact?: boolean }) {
  if (members.length === 0) return <p className="text-sm text-muted">No members to show yet.</p>;
  return (
    <ul className={cx("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {members.map((m) => (
        <li key={m.userId}>
          <Link href={`/members/${m.handle}`} className="flex h-full gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs transition hover:border-brand-300 hover:shadow-sm">
            <Avatar name={m.name} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-medium text-fg">{m.name}</p>
              {m.headline && <p className="line-clamp-2 text-sm text-muted">{m.headline}</p>}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {m.city && <span className="text-xs text-muted">{m.city}</span>}
                {m.communityRole === "ORGANIZER" && <Badge tone="violet">Organizer</Badge>}
                {m.reviewer && <Badge tone="green">Reviewer</Badge>}
                {m.wantsMentor && <Badge tone="amber">Looking for a mentor</Badge>}
              </div>
              {!compact && m.tools.length > 0 && <p className="truncate pt-1 text-xs text-muted">{m.tools.slice(0, 6).join(" · ")}</p>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
