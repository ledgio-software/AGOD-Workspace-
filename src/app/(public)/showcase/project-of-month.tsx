import Link from "next/link";
import { Trophy } from "lucide-react";
import { latestProjectOfMonth, monthLabel, standings, thisMonth } from "@/modules/community/project-month";

// Phase 31: last month's project of the month and this month's leaders (showcase and home page).

export async function ProjectOfMonth({ leaders = true }: { leaders?: boolean }) {
  const [winner, current] = await Promise.all([latestProjectOfMonth(), leaders ? standings(thisMonth(), 3) : Promise.resolve([])]);
  if (!winner && current.length === 0) return null;
  return (
    <section className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {winner ? (
        <Link href={`/showcase/${winner.postId}`} className="flex items-start gap-4 rounded-xl border border-amber-300 bg-amber-50 p-5 hover:border-amber-500 dark:border-amber-900 dark:bg-amber-950/30">
          <Trophy className="mt-1 size-8 shrink-0 text-amber-600" aria-hidden />
          <span className="min-w-0 space-y-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Project of the month · {monthLabel(winner.month)}</span>
            <span className="block text-lg font-semibold">{winner.title}</span>
            <span className="block text-sm text-muted">{winner.pitch}</span>
            <span className="block text-xs text-muted">
              by {winner.authorName}
              {winner.picked ? (winner.note ? ` · chosen by the organizers: ${winner.note}` : " · chosen by the organizers") : ` · ${winner.votes} ${winner.votes === 1 ? "vote" : "votes"}`}
            </span>
          </span>
        </Link>
      ) : (
        <div className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">
          Vote for your favourite project this month: the one with the most votes becomes project of the month.
        </div>
      )}
      <div className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Leading in {monthLabel(thisMonth())}</p>
        {current.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No votes yet. Open a project and vote for it.</p>
        ) : (
          <ol className="mt-2 space-y-1.5 text-sm">
            {current.map((s, i) => (
              <li key={s.postId} className="flex items-baseline justify-between gap-2">
                <Link href={`/showcase/${s.postId}`} className="truncate hover:underline">
                  {i + 1}. {s.title}
                </Link>
                <span className="shrink-0 text-xs text-muted">{s.votes}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
