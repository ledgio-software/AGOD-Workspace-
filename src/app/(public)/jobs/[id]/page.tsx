import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/badges";
import { Callout, Card, buttonClass } from "@/components/ui";
import { formatCalendarDate, formatDate } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { canModerate } from "@/modules/community";
import { getJob } from "@/modules/community/jobs";
import { ReportForm } from "../../../(community)/community/forms";
import { ButtonForm } from "../../../(community)/community/growth-forms";
import { applyAction, closeJobAction, reportJobAction, unhideJobAction, withdrawApplicationAction } from "../../../(community)/community/work-actions";
import { ApplyForm } from "../../../(community)/community/work-forms";
import { JobBadges, payLabel } from "../job-ui";

export const metadata: Metadata = { title: "Jobs & gigs" };

const appStatus = { SENT: "Application sent", SHORTLISTED: "You're shortlisted", HIRED: "You got it", DECLINED: "Not this time", WITHDRAWN: "Withdrawn" } as const;
const appTone = { SENT: "blue", SHORTLISTED: "amber", HIRED: "green", DECLINED: "gray", WITHDRAWN: "gray" } as const;

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getSignedIn();
  const { id } = await params;
  const job = await getJob(viewer, id);
  if (!job) notFound();
  const mine = viewer?.id === job.posterId;
  const organizer = viewer ? await canModerate(viewer) : false;
  const mineApp = job.myApplication;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Jobs &amp; gigs
      </Link>
      {job.hidden && <Callout tone="warn">Hidden by the organizers after a report. Only you and the organizers can see it.</Callout>}
      {!job.open && !job.hidden && (
        <Callout tone="info">{job.status === "FILLED" ? "This job has been filled." : "This job is no longer taking applications."}</Callout>
      )}
      <div className="space-y-2">
        <JobBadges job={job} />
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <p className="text-muted">{job.hirer}</p>
        <p className="text-lg font-semibold tabular-nums">{payLabel(job)}</p>
        <p className="text-xs text-muted">
          Posted by{" "}
          {job.posterHandle ? (
            <Link href={`/members/${job.posterHandle}`} className="hover:underline">
              {job.posterName}
            </Link>
          ) : (
            job.posterName
          )}{" "}
          on {formatDate(job.createdAt)} · apply by {formatCalendarDate(job.closesOn)}
        </p>
      </div>

      <Card title="About the work">
        <p className="whitespace-pre-line text-sm">{job.description}</p>
        {job.skills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {job.skills.map((s) => (
              <Link key={s} href={`/jobs?skill=${encodeURIComponent(s)}`} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted hover:text-fg">
                {s}
              </Link>
            ))}
          </div>
        )}
      </Card>

      {mine ? (
        <Card title="Your job" description={`${job.applications} ${job.applications === 1 ? "application" : "applications"}.`}>
          <div className="flex flex-wrap gap-2">
            <Link href="/community/jobs" className={buttonClass("primary", "sm")}>
              See applicants
            </Link>
            {job.status === "OPEN" && (
              <>
                <Link href={`/community/jobs/${job.id}/edit`} className={buttonClass("secondary", "sm")}>
                  Edit
                </Link>
                <ButtonForm action={closeJobAction.bind(null, job.id, true)} label="Mark as filled" />
                <ButtonForm action={closeJobAction.bind(null, job.id, false)} label="Close" confirmMessage="Stop taking applications?" />
              </>
            )}
          </div>
        </Card>
      ) : mineApp && mineApp.status !== "WITHDRAWN" ? (
        <Card title="Your application" aside={<Badge tone={appTone[mineApp.status]}>{appStatus[mineApp.status]}</Badge>}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/community/jobs" className="text-brand-600 hover:underline dark:text-brand-400">
              See your applications
            </Link>
            {(mineApp.status === "SENT" || mineApp.status === "SHORTLISTED") && (
              <ButtonForm action={withdrawApplicationAction.bind(null, mineApp.id)} label="Withdraw" confirmMessage="Withdraw your application?" />
            )}
          </div>
        </Card>
      ) : job.open ? (
        viewer ? (
          <Card title="Apply">
            <ApplyForm action={applyAction.bind(null, job.id)} />
          </Card>
        ) : (
          <Callout tone="info">
            <Link href="/sign-in" className="font-medium underline">
              Sign in
            </Link>
            {signupOpen() ? (
              <>
                {" "}
                or{" "}
                <Link href="/sign-up" className="font-medium underline">
                  join for free
                </Link>
              </>
            ) : null}{" "}
            to apply.
          </Callout>
        )
      ) : null}

      <Callout tone="warn" icon={ShieldAlert}>
        Agree the pay and what you&apos;ll deliver in writing before you start. Never pay anyone to get a job.
      </Callout>

      {viewer && !mine && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">Report this job</summary>
          <div className="mt-2">
            <ReportForm action={reportJobAction.bind(null, job.id)} />
          </div>
        </details>
      )}
      {organizer && job.hidden && <ButtonForm action={unhideJobAction.bind(null, job.id)} label="Show again" />}
    </div>
  );
}
