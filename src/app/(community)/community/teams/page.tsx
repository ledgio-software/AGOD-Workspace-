import Link from "next/link";
import { Mail, UsersRound } from "lucide-react";
import { Badge } from "@/components/badges";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { type RequestView, TEAM_KINDS, myTeams } from "@/modules/community/teams";
import { AnswerForm, ButtonForm } from "../growth-forms";
import { answerTeamRequestAction, closeTeamPostAction, withdrawTeamRequestAction } from "../work-actions";

// Phase 33: my team finder posts with the requests they received, and the requests I sent.

const statusLabel = { PENDING: "Waiting for an answer", ACCEPTED: "Accepted", DECLINED: "Declined", WITHDRAWN: "Withdrawn" } as const;
const tone = { PENDING: "amber", ACCEPTED: "green", DECLINED: "gray", WITHDRAWN: "gray" } as const;

function Row({ r, children }: { r: RequestView; children?: React.ReactNode }) {
  return (
    <li className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {r.person.handle ? (
            <Link href={`/members/${r.person.handle}`} className="hover:underline">
              {r.person.name}
            </Link>
          ) : (
            r.person.name
          )}{" "}
          <Badge tone={tone[r.status]}>{statusLabel[r.status]}</Badge>
        </p>
        <span className="text-xs text-muted">{formatDate(r.createdAt)}</span>
      </div>
      <p className="whitespace-pre-line text-muted">“{r.message}”</p>
      {r.responseNote && <p className="text-xs text-muted">Note: {r.responseNote}</p>}
      {r.person.email && (
        <a href={`mailto:${r.person.email}`} className="inline-flex items-center gap-1.5 text-brand-600 hover:underline dark:text-brand-400">
          <Mail className="size-4" aria-hidden /> {r.person.email}
        </a>
      )}
      {children}
    </li>
  );
}

export default async function MyTeamsPage() {
  const { member } = await requireMember();
  const { posts, sent } = await myTeams(member);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Community"
        title="My team finder"
        description="Your posts with the people who answered, and the requests you sent. When someone accepts, you both see each other's email."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/teams" className={buttonClass("secondary")}>
              Browse
            </Link>
            <Link href="/community/teams/new" className={buttonClass("primary")}>
              Post
            </Link>
          </div>
        }
      />

      <Card title="My posts">
        {posts.length === 0 ? (
          <EmptyState icon={UsersRound} title="No posts yet">
            Share an idea that needs people, or say you&apos;re looking for a team.
          </EmptyState>
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {posts.map((p) => (
              <li key={p.id} className="space-y-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p>
                    <Link href={`/teams/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>{" "}
                    <Badge tone={p.kind === "IDEA" ? "violet" : "blue"}>{TEAM_KINDS[p.kind]}</Badge>{" "}
                    {p.hidden ? <Badge tone="red">Hidden</Badge> : p.status === "OPEN" ? <Badge tone="green">Open</Badge> : <Badge>Closed</Badge>}
                  </p>
                  {p.status === "OPEN" && (
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/community/teams/${p.id}/edit`} className={buttonClass("secondary", "sm")}>
                        Edit
                      </Link>
                      <ButtonForm action={closeTeamPostAction.bind(null, p.id)} label="Close" confirmMessage="Close this post?" />
                    </div>
                  )}
                </div>
                {p.requests.length === 0 ? (
                  <p className="text-sm text-muted">No requests yet.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {p.requests.map((r) => (
                      <Row key={r.id} r={r}>
                        {r.status === "PENDING" && <AnswerForm action={answerTeamRequestAction.bind(null, r.id)} />}
                      </Row>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Requests I sent">
        {sent.length === 0 ? (
          <p className="text-sm text-muted">
            None yet.{" "}
            <Link href="/teams" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              See who&apos;s looking
            </Link>
            .
          </p>
        ) : (
          <ul className="-mx-3 divide-y divide-line">
            {sent.map((r) => (
              <Row key={r.id} r={r}>
                <p className="text-xs text-muted">
                  About{" "}
                  <Link href={`/teams/${r.post.id}`} className="hover:underline">
                    {r.post.title}
                  </Link>
                </p>
                {r.status === "PENDING" && <ButtonForm action={withdrawTeamRequestAction.bind(null, r.id)} label="Withdraw" />}
              </Row>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
