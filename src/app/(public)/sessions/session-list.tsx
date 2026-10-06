import Link from "next/link";
import { CalendarDays, PlayCircle, Users } from "lucide-react";
import { Badge } from "@/components/badges";
import { formatDateTime } from "@/lib/dates";
import { LEVELS, type SessionCard } from "@/modules/community/sessions";

/** Session cards for the sessions page, the home pages and profiles. */
export function SessionList({ sessions, empty = "No sessions yet.", past = false }: { sessions: SessionCard[]; empty?: string; past?: boolean }) {
  if (sessions.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {sessions.map((s) => {
        const seatsLeft = s.capacity === null ? null : Math.max(0, s.capacity - s.attendees);
        return (
          <li key={s.id}>
            <Link href={`/sessions/${s.id}`} className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-xs transition hover:border-brand-300 hover:shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-brand-700 dark:text-brand-300">
                <CalendarDays className="size-4" aria-hidden /> {formatDateTime(s.startsAt)}
              </div>
              <p className="font-semibold text-fg">{s.title}</p>
              <p className="text-sm text-muted">with {s.hostName}</p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted">
                <Badge>{LEVELS[s.level as keyof typeof LEVELS] ?? s.level}</Badge>
                {past ? (
                  s.recordingUrl ? (
                    <Badge tone="green">
                      <PlayCircle className="mr-0.5 inline size-3" aria-hidden />
                      Recording
                    </Badge>
                  ) : s.hasNotes ? (
                    <Badge tone="blue">Notes</Badge>
                  ) : null
                ) : seatsLeft === 0 ? (
                  <Badge tone="red">Full</Badge>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden /> {s.attendees} joined{seatsLeft !== null && ` · ${seatsLeft} seats left`}
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
