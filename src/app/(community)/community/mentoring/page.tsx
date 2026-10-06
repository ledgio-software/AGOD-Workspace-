import Link from "next/link";
import { Handshake, Mail } from "lucide-react";
import { Badge } from "@/components/badges";
import { Callout, Card, PageHeader, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { ensureProfile } from "@/modules/community";
import { type MentorshipView, mentoredCount, myMentorships } from "@/modules/community/mentorship";
import { answerRequestAction, endMentorshipAction, mentorSettingsAction, withdrawRequestAction } from "../growth-actions";
import { AnswerForm, ButtonForm, MentorSettingsForm } from "../growth-forms";

// Phase 31: my mentoring: offering to mentor, requests to answer, and my own mentors.

const statusTone = { PENDING: "amber", ACTIVE: "green", DECLINED: "gray", WITHDRAWN: "gray", ENDED: "gray" } as const;
const statusLabel = { PENDING: "Waiting for an answer", ACTIVE: "Active", DECLINED: "Declined", WITHDRAWN: "Withdrawn", ENDED: "Ended" } as const;

function Row({ m, children }: { m: MentorshipView; children?: React.ReactNode }) {
  return (
    <li className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {m.other.handle ? (
            <Link href={`/members/${m.other.handle}`} className="hover:underline">
              {m.other.name}
            </Link>
          ) : (
            m.other.name
          )}{" "}
          <Badge tone={statusTone[m.status as keyof typeof statusTone]}>{statusLabel[m.status as keyof typeof statusLabel]}</Badge>
        </p>
        <span className="text-xs text-muted">{formatDate(m.createdAt)}</span>
      </div>
      <p className="text-muted">“{m.goal}”</p>
      {m.responseNote && <p className="text-xs text-muted">Note: {m.responseNote}</p>}
      {m.other.email && (
        <a href={`mailto:${m.other.email}`} className="inline-flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-400">
          <Mail className="size-4" aria-hidden /> {m.other.email}
        </a>
      )}
      {children}
    </li>
  );
}

export default async function MentoringPage() {
  const { member } = await requireMember();
  const [profile, mine, count] = await Promise.all([ensureProfile(member), myMentorships(member), mentoredCount(member.id)]);
  const requests = mine.asMentor.filter((m) => m.status === "PENDING");
  const mentees = mine.asMentor.filter((m) => m.status !== "PENDING");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Community"
        title="My mentoring"
        description="Ask experienced builders for help, or help others. Once a mentor accepts, you both see each other's email to agree how to meet."
        actions={
          <Link href="/mentors" className={buttonClass("primary")}>
            Find a mentor
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="My mentors" description="People you asked for help.">
          {mine.asMentee.length === 0 ? (
            <p className="text-sm text-muted">
              You haven&apos;t asked anyone yet. <Link href="/mentors" className="font-medium text-brand-600 hover:underline dark:text-brand-400">See the mentors</Link>.
            </p>
          ) : (
            <ul className="-mx-4 divide-y divide-line">
              {mine.asMentee.map((m) => (
                <Row key={m.id} m={m}>
                  {m.status === "PENDING" && <ButtonForm action={withdrawRequestAction.bind(null, m.id)} label="Withdraw" />}
                  {m.status === "ACTIVE" && <ButtonForm action={endMentorshipAction.bind(null, m.id)} label="End mentorship" confirmMessage="End this mentorship?" />}
                </Row>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Mentoring others" description={count > 0 ? `You have mentored ${count} ${count === 1 ? "person" : "people"}. Thank you!` : undefined} aside={<Handshake className="size-4 text-muted" aria-hidden />}>
          <div className="space-y-5">
            {profile.reviewer ? (
              <MentorSettingsForm action={mentorSettingsAction} defaults={{ open: profile.mentorOpen, capacity: profile.mentorCapacity, note: profile.mentorNote ?? "" }} />
            ) : (
              <Callout tone="info">
                Mentors are Reviewers. Tick <strong>I can review work and mentor</strong> on{" "}
                <Link href="/community/profile" className="font-medium underline">
                  your profile
                </Link>{" "}
                first.
              </Callout>
            )}
            {requests.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Requests waiting for you</h3>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {requests.map((m) => (
                    <Row key={m.id} m={m}>
                      <AnswerForm action={answerRequestAction.bind(null, m.id)} />
                    </Row>
                  ))}
                </ul>
              </div>
            )}
            {mentees.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">People you mentor</h3>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {mentees.map((m) => (
                    <Row key={m.id} m={m}>
                      {m.status === "ACTIVE" && <ButtonForm action={endMentorshipAction.bind(null, m.id)} label="End mentorship" confirmMessage="End this mentorship?" />}
                    </Row>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
