import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/badges";
import { Callout, Card, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { canModerate } from "@/modules/community";
import { REWARDS, TEAM_KINDS, getTeamPost } from "@/modules/community/teams";
import { ReportForm } from "../../../(community)/community/forms";
import { ButtonForm } from "../../../(community)/community/growth-forms";
import { closeTeamPostAction, reportTeamPostAction, teamRequestAction, unhideTeamPostAction, withdrawTeamRequestAction } from "../../../(community)/community/work-actions";
import { TeamRequestForm } from "../../../(community)/community/work-forms";

export const metadata: Metadata = { title: "Team finder" };

const reqStatus = { PENDING: "Waiting for an answer", ACCEPTED: "Accepted", DECLINED: "Not this time", WITHDRAWN: "Withdrawn" } as const;
const reqTone = { PENDING: "amber", ACCEPTED: "green", DECLINED: "gray", WITHDRAWN: "gray" } as const;

export default async function TeamPostPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getSignedIn();
  const { id } = await params;
  const post = await getTeamPost(viewer, id);
  if (!post) notFound();
  const mine = viewer?.id === post.authorId;
  const organizer = viewer ? await canModerate(viewer) : false;
  const idea = post.kind === "IDEA";
  const open = post.status === "OPEN" && !post.hidden;
  const req = post.myRequest;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/teams" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Team finder
      </Link>
      {post.hidden && <Callout tone="warn">Hidden by the organizers after a report. Only you and the organizers can see it.</Callout>}
      {post.status === "CLOSED" && <Callout tone="info">This post is closed.</Callout>}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={idea ? "violet" : "blue"}>{TEAM_KINDS[post.kind]}</Badge>
          <Badge>{REWARDS[post.reward]}</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{post.title}</h1>
        <p className="text-xs text-muted">
          By{" "}
          {post.authorHandle ? (
            <Link href={`/members/${post.authorHandle}`} className="hover:underline">
              {post.authorName}
            </Link>
          ) : (
            post.authorName
          )}
          {post.authorCity ? ` in ${post.authorCity}` : ""} on {formatDate(post.createdAt)}
        </p>
      </div>

      <Card>
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">{idea ? "The idea" : "About"}</dt>
            <dd className="mt-1 whitespace-pre-line">{post.description}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">{idea ? "Roles needed" : "Roles they can take"}</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {post.roles.map((r) => (
                <Link key={r} href={`/teams?role=${encodeURIComponent(r)}`} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs hover:text-brand-600">
                  {r}
                </Link>
              ))}
            </dd>
          </div>
          {post.tools.length > 0 && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">Tools</dt>
              <dd className="mt-1">{post.tools.join(", ")}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Time needed</dt>
            <dd className="mt-1">{post.commitment}</dd>
          </div>
        </dl>
      </Card>

      {mine ? (
        <Card title="Your post">
          <div className="flex flex-wrap gap-2">
            <Link href="/community/teams" className={buttonClass("primary", "sm")}>
              See requests
            </Link>
            {post.status === "OPEN" && (
              <>
                <Link href={`/community/teams/${post.id}/edit`} className={buttonClass("secondary", "sm")}>
                  Edit
                </Link>
                <ButtonForm action={closeTeamPostAction.bind(null, post.id)} label="Close" confirmMessage="Close this post?" />
              </>
            )}
          </div>
        </Card>
      ) : req && req.status !== "WITHDRAWN" ? (
        <Card title={idea ? "Your request" : "Your invitation"} aside={<Badge tone={reqTone[req.status]}>{reqStatus[req.status]}</Badge>}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/community/teams" className="text-brand-600 hover:underline dark:text-brand-400">
              See your requests
            </Link>
            {req.status === "PENDING" && <ButtonForm action={withdrawTeamRequestAction.bind(null, req.id)} label="Withdraw" />}
          </div>
        </Card>
      ) : open ? (
        viewer ? (
          <Card title={idea ? "Ask to join" : "Invite them to your team"}>
            <TeamRequestForm action={teamRequestAction.bind(null, post.id)} idea={idea} />
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
            to {idea ? "ask to join" : "invite them"}.
          </Callout>
        )
      ) : null}

      {viewer && !mine && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">Report this post</summary>
          <div className="mt-2">
            <ReportForm action={reportTeamPostAction.bind(null, post.id)} />
          </div>
        </details>
      )}
      {organizer && post.hidden && <ButtonForm action={unhideTeamPostAction.bind(null, post.id)} label="Show again" />}
    </div>
  );
}
