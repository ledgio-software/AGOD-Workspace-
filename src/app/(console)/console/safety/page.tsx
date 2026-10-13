import Link from "next/link";
import { ExternalLink, ShieldCheck, Vote } from "lucide-react";
import { Card, Disclosure, EmptyState, PageHeader, StatCard, cx } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { PROBATION_DAYS } from "@/modules/safety/screen";
import { heldJobs, riskQueue, safetyCounts, voteQueue } from "@/modules/safety";
import { openAppeals } from "@/modules/safety/appeals";
import { banAction, clearFlagAction, decideAppealAction, discountVotesAction, hideFlaggedAction } from "../actions";
import { ConfirmButton, ReasonForm } from "../forms";

export const metadata = { title: "Trust & safety" };

// Phase 41: what the scam check found, riskiest first. Staff decide: clear it, hide it, or ban the
// author and hide everything they posted. Jobs that look like scams wait here before being listed.
// Phase 42: appeals and suspicious votes.

const scoreTone = (score: number) => (score >= 60 ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : score >= 40 ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-surface-muted text-muted");

export default async function ConsoleSafety() {
  const me = (await getSignedIn())!;
  const [queue, held, counts, appeals, votes] = await Promise.all([riskQueue(me), heldJobs(me), safetyCounts(me), openAppeals(me), voteQueue(me)]);
  const queueOnly = queue.filter((q) => !(q.targetType === "JOB" && held.some((h) => h.id === q.targetId)));

  return (
    <>
      <PageHeader
        title="Trust & safety"
        description={`The scam check reads every job, chat message, article, comment, project, profile, tool and team post. It flags fee requests, PIN and ID requests, quick-money schemes, moves to WhatsApp, and links that hide or fake where they go. It never removes anything by itself: you decide. New accounts can't post jobs, share links in chat or ask mentors until they've confirmed their email and been here ${PROBATION_DAYS} days.`}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Jobs waiting for a check" value={counts.heldJobs} tone={counts.heldJobs ? "warn" : "default"} />
        <StatCard label="Open flags" value={counts.openFlags} tone={counts.openFlags ? "warn" : "default"} />
        <StatCard label="Appeals" value={counts.openAppeals} tone={counts.openAppeals ? "warn" : "default"} />
        <StatCard label="Suspicious votes" value={votes.length} tone={votes.length ? "warn" : "default"} />
      </div>

      {appeals.length > 0 && (
        <Card title={`Appeals · ${appeals.length}`} description="People asking for a second look. Accepting restores the login or shows the post again; they're emailed your note either way.">
          <ul className="divide-y divide-line">
            {appeals.map((a) => (
              <li key={a.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {a.link ? (
                      <Link href={a.link} className="hover:underline">
                        {a.what}
                      </Link>
                    ) : (
                      a.what
                    )}
                  </p>
                  <span className="text-xs text-muted">
                    {a.person ? (
                      <Link href={`/console/people/${a.person.id}`} className="hover:underline">
                        {a.person.name}
                      </Link>
                    ) : null}{" "}
                    ({a.email}) · {formatDateTime(a.createdAt)}
                  </span>
                </div>
                {a.why && <p className="text-xs text-muted">Why it was {a.kind === "ACCOUNT" ? "blocked" : "hidden"}: {a.why}</p>}
                <p className="whitespace-pre-line rounded-lg bg-surface-muted px-3 py-2 text-sm">{a.message}</p>
                <div className="flex flex-wrap items-start gap-3">
                  <Disclosure summary="Accept" className="min-w-56 flex-1">
                    <div className="p-4">
                      <ReasonForm
                        action={decideAppealAction.bind(null, a.id, true)}
                        label={a.kind === "ACCOUNT" ? "Accept and restore the login" : "Accept and show it again"}
                        confirmMessage="Accept this appeal?"
                        fieldLabel="Note to them"
                        hint="Emailed to them and kept in the back-office log."
                        placeholder="e.g. Thanks, we checked and it was a mistake"
                      />
                    </div>
                  </Disclosure>
                  <Disclosure summary="Keep the decision" className="min-w-56 flex-1">
                    <div className="p-4">
                      <ReasonForm
                        action={decideAppealAction.bind(null, a.id, false)}
                        label="Reject the appeal"
                        danger
                        confirmMessage="Reject this appeal?"
                        fieldLabel="Note to them"
                        hint="Emailed to them and kept in the back-office log."
                        placeholder="e.g. The post asked applicants for a fee"
                      />
                    </div>
                  </Disclosure>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

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

      <Card
        title={`Suspicious votes · ${votes.length}`}
        description="Projects, articles and tools whose votes come mostly from brand-new accounts, unconfirmed emails, or accounts linked to the author. Discounting removes just those votes."
      >
        {votes.length === 0 ? (
          <EmptyState icon={Vote} title="Votes look normal" />
        ) : (
          <ul className="divide-y divide-line">
            {votes.map((v) => (
              <li key={`${v.source}:${v.targetId}`} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-muted">{v.sourceLabel}</p>
                  <Link href={v.link} className="inline-flex items-center gap-1 font-medium hover:underline">
                    <span className="line-clamp-1">{v.label}</span> <ExternalLink className="size-3 shrink-0 text-muted" aria-hidden />
                  </Link>
                  <p className="text-xs text-muted">
                    {v.suspicious} of {v.total} votes look fake: {v.reasons.newVoters} from new accounts, {v.reasons.unconfirmed} unconfirmed, {v.reasons.linked} linked to the author ·{" "}
                    <Link href={`/console/people/${v.authorId}`} className="hover:underline">
                      author
                    </Link>
                  </p>
                </div>
                <ConfirmButton action={discountVotesAction.bind(null, v.source, v.targetId)} label={`Discount ${v.suspicious} vote(s)`} confirmMessage="Remove these suspicious votes?" variant="danger" />
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
