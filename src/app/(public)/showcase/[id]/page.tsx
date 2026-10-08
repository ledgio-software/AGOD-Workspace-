import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Code2, ExternalLink, EyeOff, PlayCircle, Sparkles, TriangleAlert, Trophy } from "lucide-react";
import { Badge } from "@/components/badges";
import { Avatar, Callout, Card, Disclosure, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { FEEDBACK_AREAS, MAX_IMAGES, NEEDS, STATUS_LABEL, getPost, screenshotsAvailable, videoHost } from "@/modules/community/showcase";
import { STATUS_TONE } from "@/modules/community/showcase-labels";
import {
  addReviewAction,
  addScreenshotAction,
  removePostAction,
  removeScreenshotAction,
  replyToReviewAction,
  reportPostAction,
  reportReviewAction,
  setPostStatusAction,
  unhideShowcaseAction,
} from "../../../(community)/community/actions";
import { ReportForm } from "../../../(community)/community/forms";
import { pickProjectAction, voteAction } from "../../../(community)/community/growth-actions";
import { PickForm, VoteButton } from "../../../(community)/community/growth-forms";
import { monthLabel, monthsWon, myVote, previousMonth, thisMonth, votesThisMonth } from "@/modules/community/project-month";
import { ButtonForm, ReplyForm, ReviewForm, ScreenshotForm } from "../../../(community)/community/showcase/forms";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string; screenshot?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await getPost((await params).id, await getSignedIn());
  return { title: found ? found.post.title : "Project" };
}

const areaLabel = (a: string) => FEEDBACK_AREAS[a as keyof typeof FEEDBACK_AREAS] ?? a;

export default async function PostPage({ params, searchParams }: Params) {
  const viewer = await getSignedIn();
  const found = await getPost((await params).id, viewer);
  if (!found) notFound();
  const { post: p, author, images, reviews, self, organizer, reviewed } = found;
  // Phase 31: project of the month.
  const [vote, votes, won] = await Promise.all([myVote(viewer), votesThisMonth([p.id]), monthsWon([p.id])]);
  const lastMonth = previousMonth(thisMonth());
  const flags = await searchParams;
  const img = (id: string) => `/showcase/${p.id}/images/${id}`;
  const links = [
    p.liveUrl && { url: p.liveUrl, label: "Try it", icon: ExternalLink },
    p.videoUrl && { url: p.videoUrl, label: `Watch the demo (${videoHost(p.videoUrl)})`, icon: PlayCircle },
    p.repoUrl && { url: p.repoUrl, label: "Code", icon: Code2 },
  ].filter(Boolean) as { url: string; label: string; icon: typeof ExternalLink }[];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {flags.posted && self && (
        <Callout tone="good" icon={CircleCheck}>
          Your project is in the showcase. Share the link, and review someone else&apos;s project while you wait for feedback.
        </Callout>
      )}
      {flags.screenshot === "failed" && self && (
        <Callout tone="warn" icon={TriangleAlert}>
          Your project was shared, but the screenshot couldn&apos;t be saved. Try adding it again below.
        </Callout>
      )}
      {p.hiddenAt && (
        <Callout tone="bad" icon={EyeOff}>
          Hidden by the organizers{p.hiddenReason ? `: ${p.hiddenReason}` : "."} Only the author and the organizers can see it.
        </Callout>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE]}>{STATUS_LABEL[p.status as keyof typeof STATUS_LABEL]}</Badge>
          {p.aiBuilt && (
            <Badge tone="violet">
              <Sparkles className="mr-0.5 inline size-3" aria-hidden />
              Mostly AI-built
            </Badge>
          )}
          {p.visibility === "MEMBERS" && <Badge>Members only</Badge>}
          {(won.get(p.id) ?? []).map((m) => (
            <Badge key={m} tone="amber">
              <Trophy className="mr-0.5 inline size-3" aria-hidden />
              Project of the month, {monthLabel(m)}
            </Badge>
          ))}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{p.title}</h1>
        <p className="text-lg text-muted">{p.pitch}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Avatar name={author.name} size="sm" />
          {author.handle ? (
            <Link href={`/members/${author.handle}`} className="font-medium text-fg hover:underline">
              {author.name}
            </Link>
          ) : (
            <span className="font-medium text-fg">{author.name}</span>
          )}
          <span>· {formatDateTime(p.createdAt)}</span>
        </div>
        {viewer && !self && !p.hiddenAt && (
          <div className="pt-1">
            <VoteButton action={voteAction.bind(null, p.id)} voted={vote === p.id} votes={votes.get(p.id) ?? 0} />
          </div>
        )}
        {organizer && !p.hiddenAt && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-fg">Organizers: project of the month</summary>
            <div className="mt-2 max-w-md">
              <PickForm action={pickProjectAction.bind(null, p.id)} month={monthLabel(lastMonth)} />
            </div>
          </details>
        )}
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {links.map(({ url, label, icon: Icon }, i) => (
              <a key={url} href={url} target="_blank" rel="nofollow ugc noopener noreferrer" className={buttonClass(i === 0 ? "primary" : "secondary", "sm")}>
                <Icon className="size-4" aria-hidden /> {label}
              </a>
            ))}
          </div>
        )}
      </div>

      {images.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map((id, i) => (
            <figure key={id} className={i === 0 && images.length % 2 === 1 ? "sm:col-span-2" : undefined}>
              <a href={img(id)} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img(id)} alt={`${p.title}, screenshot ${i + 1}`} loading="lazy" className="w-full rounded-xl border border-line object-cover" />
              </a>
              {self && (
                <figcaption className="mt-2">
                  <ButtonForm action={removeScreenshotAction.bind(null, p.id, id)} label="Remove screenshot" confirmMessage="Remove this screenshot?" />
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {(p.audience || p.builtWith.length > 0) && (
            <Card title="About">
              <dl className="space-y-3 text-sm">
                {p.audience && (
                  <div>
                    <dt className="text-xs text-muted">Who it is for</dt>
                    <dd>{p.audience}</dd>
                  </div>
                )}
                {p.builtWith.length > 0 && (
                  <div>
                    <dt className="text-xs text-muted">Built with</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {p.builtWith.map((t) => (
                        <span key={t} className="rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-xs">
                          {t}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          )}

          <Card id="reviews" title={`Feedback (${reviews.filter((r) => !r.hidden).length})`}>
            <div className="space-y-5 text-sm">
              {reviews.length === 0 && <p className="text-muted">No feedback yet.</p>}
              {reviews.map((r) => (
                <article key={r.id} className="space-y-2 border-b border-line pb-5 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Avatar name={r.reviewerName} size="sm" />
                    {r.reviewerHandle ? (
                      <Link href={`/members/${r.reviewerHandle}`} className="font-medium hover:underline">
                        {r.reviewerName}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.reviewerName}</span>
                    )}
                    {r.reviewerIsReviewer && <Badge tone="green">Reviewer</Badge>}
                    <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                    {r.hidden && <Badge tone="red">Hidden{r.hiddenReason ? `: ${r.hiddenReason}` : ""}</Badge>}
                  </div>
                  <div className="space-y-2">
                    <p>
                      <span className="font-medium">What works: </span>
                      <span className="whitespace-pre-line break-words">{r.whatWorks}</span>
                    </p>
                    {r.toImprove && (
                      <p>
                        <span className="font-medium">To improve: </span>
                        <span className="whitespace-pre-line break-words">{r.toImprove}</span>
                      </p>
                    )}
                    <p>
                      <span className="font-medium">Next step: </span>
                      <span className="whitespace-pre-line break-words">{r.nextStep}</span>
                    </p>
                  </div>
                  {r.authorReply && (
                    <div className="ml-4 rounded-lg border-l-2 border-brand-300 bg-surface-muted px-3 py-2">
                      <p className="text-xs text-muted">{author.name} replied</p>
                      <p className="whitespace-pre-line break-words">{r.authorReply}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {self && !r.authorReply && !r.hidden && (
                      <Disclosure summary="Reply">
                        <ReplyForm action={replyToReviewAction.bind(null, p.id, r.id)} />
                      </Disclosure>
                    )}
                    {viewer && viewer.id !== r.reviewerId && !r.hidden && (
                      <Disclosure summary="Report">
                        <ReportForm action={reportReviewAction.bind(null, r.id)} />
                      </Disclosure>
                    )}
                    {organizer && r.hidden && <ButtonForm action={unhideShowcaseAction.bind(null, p.id, "REVIEW", r.id)} label="Show again" />}
                  </div>
                </article>
              ))}
            </div>
          </Card>

          {viewer && !self && !reviewed && !p.hiddenAt && (
            <Card title="Give feedback" description="Start with what works, name one or two specific problems, and suggest a next step.">
              <ReviewForm action={addReviewAction.bind(null, p.id)} areas={p.feedbackAreas.map(areaLabel)} />
            </Card>
          )}
          {viewer && !self && reviewed && (
            <Callout tone="good" icon={CircleCheck}>
              Thank you for giving back! You gave feedback on this project, and {author.name.split(/\s+/)[0]} has been told.
            </Callout>
          )}
          {!viewer && (
            <p className="text-sm text-muted">
              <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                Sign in
              </Link>{" "}
              to give feedback.
            </p>
          )}
        </div>

        <div className="space-y-6">
          {(p.feedbackAreas.length > 0 || p.feedbackWanted || p.stuckOn || p.needs.length > 0) && (
            <Card title="What they're asking for">
              <div className="space-y-3 text-sm">
                {p.feedbackAreas.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {p.feedbackAreas.map((a) => (
                      <Badge key={a} tone="blue">
                        {areaLabel(a)}
                      </Badge>
                    ))}
                  </div>
                )}
                {p.feedbackWanted && <p className="whitespace-pre-line break-words">{p.feedbackWanted}</p>}
                {p.stuckOn && (
                  <div>
                    <p className="text-xs text-muted">Stuck on</p>
                    <p className="whitespace-pre-line break-words">{p.stuckOn}</p>
                  </div>
                )}
                {p.needs.length > 0 && (
                  <div>
                    <p className="text-xs text-muted">Looking for</p>
                    <p>{p.needs.map((n) => NEEDS[n as keyof typeof NEEDS] ?? n).join(", ")}</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {self && (
            <Card title="Your project">
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Link href={`/community/showcase/${p.id}/edit`} className={buttonClass("secondary", "sm")}>
                    Edit
                  </Link>
                  {p.status !== "SHIPPED" && <ButtonForm action={setPostStatusAction.bind(null, p.id, "SHIPPED")} label="Mark as shipped" />}
                  {p.status !== "NEEDS_REVIEW" && <ButtonForm action={setPostStatusAction.bind(null, p.id, "NEEDS_REVIEW")} label="Ask for more feedback" />}
                </div>
                {screenshotsAvailable() && images.length < MAX_IMAGES && <ScreenshotForm action={addScreenshotAction.bind(null, p.id)} />}
                <ButtonForm action={removePostAction.bind(null, p.id)} label="Take it down" variant="danger" confirmMessage="Take this project down? It disappears from the showcase with its screenshots and feedback." />
              </div>
            </Card>
          )}

          {organizer && !self && p.hiddenAt && (
            <Card title="Organizer tools">
              <ButtonForm action={unhideShowcaseAction.bind(null, p.id, "POST", p.id)} label="Show the project again" />
            </Card>
          )}

          {viewer && !self && !p.hiddenAt && (
            <Disclosure summary="Report this project">
              <ReportForm action={reportPostAction.bind(null, p.id)} />
            </Disclosure>
          )}
        </div>
      </div>
    </div>
  );
}
