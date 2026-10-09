import Link from "next/link";
import { Briefcase, ExternalLink, Mail } from "lucide-react";
import { Badge } from "@/components/badges";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { formatCalendarDate, formatDate } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { type ApplicationView, myJobs } from "@/modules/community/jobs";
import { payLabel } from "../../../(public)/jobs/job-ui";
import { ButtonForm } from "../growth-forms";
import { applicationStatusAction, closeJobAction, withdrawApplicationAction } from "../work-actions";

// Phase 33: my jobs with their applicants, and my own applications.

const label = { SENT: "New", SHORTLISTED: "Shortlisted", HIRED: "Hired", DECLINED: "Declined", WITHDRAWN: "Withdrawn" } as const;
const mineLabel = { SENT: "Sent", SHORTLISTED: "Shortlisted", HIRED: "You got it", DECLINED: "Not this time", WITHDRAWN: "Withdrawn" } as const;
const tone = { SENT: "blue", SHORTLISTED: "amber", HIRED: "green", DECLINED: "gray", WITHDRAWN: "gray" } as const;

function Person({ a }: { a: ApplicationView }) {
  return (
    <span className="font-medium">
      {a.person.handle ? (
        <Link href={`/members/${a.person.handle}`} className="hover:underline">
          {a.person.name}
        </Link>
      ) : (
        a.person.name
      )}
    </span>
  );
}

export default async function MyJobsPage() {
  const { member } = await requireMember();
  const { posted, applied } = await myJobs(member);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Community"
        title="My jobs & applications"
        description="Jobs you posted with the people who applied, and the jobs you applied for."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/jobs" className={buttonClass("secondary")}>
              Browse jobs
            </Link>
            <Link href="/community/jobs/new" className={buttonClass("primary")}>
              Post a job
            </Link>
          </div>
        }
      />

      <Card title="Jobs I posted">
        {posted.length === 0 ? (
          <EmptyState icon={Briefcase} title="You haven't posted a job">
            Hiring for a gig or a role? Post it for the community.
          </EmptyState>
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {posted.map((j) => (
              <li key={j.id} className="space-y-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                      {j.title}
                    </Link>{" "}
                    {j.hidden ? <Badge tone="red">Hidden</Badge> : j.held ? <Badge tone="amber">Waiting for a check</Badge> : j.open ? <Badge tone="green">Open</Badge> : <Badge>{j.status === "FILLED" ? "Filled" : "Closed"}</Badge>}
                    <p className="text-xs text-muted">
                      {payLabel(j)} · closes {formatCalendarDate(j.closesOn)}
                    </p>
                  </div>
                  {j.status === "OPEN" && (
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/community/jobs/${j.id}/edit`} className={buttonClass("secondary", "sm")}>
                        Edit
                      </Link>
                      <ButtonForm action={closeJobAction.bind(null, j.id, true)} label="Mark as filled" />
                      <ButtonForm action={closeJobAction.bind(null, j.id, false)} label="Close" confirmMessage="Stop taking applications?" />
                    </div>
                  )}
                </div>
                {j.applications.length === 0 ? (
                  <p className="text-sm text-muted">No applications yet.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {j.applications.map((a) => (
                      <li key={a.id} className="space-y-2 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p>
                            <Person a={a} /> <Badge tone={tone[a.status]}>{label[a.status]}</Badge>
                          </p>
                          <span className="text-xs text-muted">{formatDate(a.createdAt)}</span>
                        </div>
                        <p className="whitespace-pre-line text-muted">{a.message}</p>
                        <div className="flex flex-wrap items-center gap-4">
                          {a.person.email && (
                            <a href={`mailto:${a.person.email}`} className="inline-flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-400">
                              <Mail className="size-4" aria-hidden /> {a.person.email}
                            </a>
                          )}
                          {a.link && (
                            <a href={a.link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-400">
                              <ExternalLink className="size-4" aria-hidden /> Their work
                            </a>
                          )}
                        </div>
                        {(a.status === "SENT" || a.status === "SHORTLISTED") && (
                          <div className="flex flex-wrap gap-2">
                            {a.status === "SENT" && <ButtonForm action={applicationStatusAction.bind(null, a.id, "SHORTLISTED")} label="Shortlist" />}
                            <ButtonForm action={applicationStatusAction.bind(null, a.id, "HIRED")} label="Hire" variant="primary" confirmMessage={`Hire ${a.person.name}? They'll get your email.`} />
                            <ButtonForm action={applicationStatusAction.bind(null, a.id, "DECLINED")} label="Decline" confirmMessage={`Decline ${a.person.name}?`} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Jobs I applied for">
        {applied.length === 0 ? (
          <p className="text-sm text-muted">
            You haven&apos;t applied for anything yet.{" "}
            <Link href="/jobs" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              See the open jobs
            </Link>
            .
          </p>
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {applied.map((a) => (
              <li key={a.id} className="space-y-1.5 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <Link href={`/jobs/${a.job.id}`} className="font-medium hover:underline">
                      {a.job.title}
                    </Link>{" "}
                    <span className="text-muted">· {a.job.hirer}</span> <Badge tone={tone[a.status]}>{mineLabel[a.status]}</Badge>
                  </p>
                  <span className="text-xs text-muted">{formatDate(a.createdAt)}</span>
                </div>
                {a.person.email && (
                  <a href={`mailto:${a.person.email}`} className="inline-flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-400">
                    <Mail className="size-4" aria-hidden /> Write to {a.person.name}: {a.person.email}
                  </a>
                )}
                {(a.status === "SENT" || a.status === "SHORTLISTED") && (
                  <ButtonForm action={withdrawApplicationAction.bind(null, a.id)} label="Withdraw" confirmMessage="Withdraw your application?" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
