import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Card, Disclosure, EmptyState, PageHeader, StatCard, cx } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { PROBATION_DAYS } from "@/modules/safety/screen";
import { heldJobs, riskQueue, safetyCounts } from "@/modules/safety";
import { banAction, clearFlagAction, hideFlaggedAction } from "../actions";
import { ConfirmButton, ReasonForm } from "../forms";

export const metadata = { title: "Trust & safety" };

// Phase 41: what the scam check found, riskiest first. Staff decide: clear it, hide it, or ban the
// author and hide everything they posted. Jobs that look like scams wait here before being listed.

const scoreTone = (score: number) => (score >= 60 ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : score >= 40 ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-surface-muted text-muted");

export default async function ConsoleSafety() {
  const me = (await getSignedIn())!;
  const [queue, held, counts] = await Promise.all([riskQueue(me), heldJobs(me), safetyCounts(me)]);
  const queueOnly = queue.filter((q) => !(q.targetType === "JOB" && held.some((h) => h.id === q.targetId)));

  return (
    <>
      <PageHeader
        title="Trust & safety"
        description={`The scam check reads every job, chat message, article, comment, project, profile, tool and team post. It flags fee requests, PIN and ID requests, quick-money schemes, moves to WhatsApp, and links that hide or fake where they go. It never removes anything by itself: you decide. New accounts can't post jobs, share links in chat or ask mentors until they've confirmed their email and been here ${PROBATION_DAYS} days.`}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Jobs waiting for a check" value={counts.heldJobs} tone={counts.heldJobs ? "warn" : "default"} />
        <StatCard label="Open flags" value={counts.openFlags} tone={counts.openFlags ? "warn" : "default"} />
        <StatCard label="Moderation" value="Reports →" href="/console/moderation" />
      </div>

      <Card title={`Jobs waiting for a check · ${held.length}`} description="Not listed until you approve them. Reject one to hide it; ban the poster if it's a scam.">
        {held.length === 0 ? (
          <p className="text-sm text-muted">No jobs waiting.</p>
        ) : (
          <ul className="divide-y divide-line">
            {held.map((j) => (
              <li key={j.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/jobs/${j.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                    {j.title} · {j.hirer} <ExternalLink className="size-3 text-muted" aria-hidden />
                  </Link>
                  <span className="text-xs text-muted">
                    by{" "}
                    <Link href={`/console/people/${j.posterId}`} className="hover:underline">
                      {j.posterName}
                    </Link>{" "}
                    · held {formatDateTime(j.heldAt)}
                  </span>
                </div>
                {j.signals.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {j.signals.map((s) => (
                      <li key={s} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
                {j.flagId && (
                  <div className="flex flex-wrap items-start gap-3">
                    <ConfirmButton action={clearFlagAction.bind(null, j.flagId)} label="Approve and list it" variant="primary" />
                    <Disclosure summary="Reject (hide it)" className="min-w-64 flex-1">
                      <div className="p-4">
                        <ReasonForm action={hideFlaggedAction.bind(null, j.flagId)} label="Hide this job" danger confirmMessage="Hide this job?" placeholder="e.g. Asks applicants for a fee" />
                      </div>
                    </Disclosure>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Risk queue · ${queueOnly.length}`} description="Riskiest first. The score adds up what was found (new accounts score a little higher).">
        {queueOnly.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nothing flagged" />
        ) : (
          <ul className="divide-y divide-line">
            {queueOnly.map((q) => (
              <li key={q.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs text-muted">
                      {q.kind} · {formatDateTime(q.createdAt)}
                      {q.hidden && " · already hidden"}
                    </p>
                    <Link href={q.link} className="inline-flex items-center gap-1 font-medium hover:underline">
                      <span className="line-clamp-1">{q.label}</span> <ExternalLink className="size-3 shrink-0 text-muted" aria-hidden />
                    </Link>
                  </div>
                  <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", scoreTone(q.score))}>Risk {q.score}</span>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {q.signals.map((s) => (
                    <li key={s} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">
                      {s}
                    </li>
                  ))}
                </ul>
                {q.excerpt && <p className="rounded-lg bg-surface-muted px-3 py-2 font-mono text-xs break-words">{q.excerpt}</p>}
                <p className="text-xs text-muted">
                  By{" "}
                  <Link href={`/console/people/${q.author.id}`} className="font-medium text-fg hover:underline">
                    {q.author.name}
                  </Link>{" "}
                  ({q.author.email}) · joined {formatDate(q.author.joined)}
                  {q.author.openFlags > 1 && <span className="font-medium text-red-700 dark:text-red-400"> · {q.author.openFlags} open flags</span>}
                  {!q.author.active && " · login blocked"}
                </p>
                <div className="flex flex-wrap items-start gap-3">
                  <ConfirmButton action={clearFlagAction.bind(null, q.id)} label="Not a problem" />
                  {!q.hidden && (
                    <Disclosure summary="Hide it" className="min-w-56 flex-1">
                      <div className="p-4">
                        <ReasonForm action={hideFlaggedAction.bind(null, q.id)} label="Hide" danger confirmMessage={`Hide this ${q.kind.toLowerCase()}?`} placeholder="e.g. Phishing link" />
                      </div>
                    </Disclosure>
                  )}
                  {q.author.active && (
                    <Disclosure summary="Ban the author" className="min-w-56 flex-1">
                      <div className="p-4">
                        <ReasonForm
                          action={banAction.bind(null, q.author.id)}
                          label="Ban and hide everything"
                          danger
                          confirmMessage={`Ban ${q.author.name}? They'll be signed out and everything they posted will be hidden.`}
                          placeholder="e.g. Job scam asking for fees"
                        />
                      </div>
                    </Disclosure>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
