import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, Bookmark, Clock, Hand, Repeat2 } from "lucide-react";
import { Avatar, Callout, Card, buttonClass } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Markdown } from "@/lib/markdown";
import { getSignedIn } from "@/lib/session";
import { type ArticleComment, getArticle } from "@/modules/community/articles";
import {
  bookmarkAction,
  commentAction,
  deleteCommentAction,
  publishAction,
  removeArticleAction,
  reportArticleAction,
  reportCommentAction,
  repostAction,
  reviewArticleAction,
  unhideArticleAction,
  usefulArticleAction,
} from "../../../(community)/community/article-actions";
import { ArticleReviewForm, CommentForm, RepostForm } from "../../../(community)/community/article-forms";
import { ReportForm } from "../../../(community)/community/forms";
import { ButtonForm } from "../../../(community)/community/growth-forms";
import { pageMetadata } from "@/lib/site";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const a = await getArticle(await getSignedIn(), (await params).id);
  return a ? pageMetadata(a.title, a.summary, { type: "article", publishedTime: a.publishedAt }) : { title: "Article" };
}

const Name = ({ name, handle }: { name: string; handle: string | null }) =>
  handle ? (
    <Link href={`/members/${handle}`} className="font-medium hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );

export default async function ArticlePage({ params }: Params) {
  const viewer = await getSignedIn();
  const a = await getArticle(viewer, (await params).id);
  if (!a) notFound();
  const live = a.status === "PUBLISHED" && !a.hidden;
  const top = a.commentsList.filter((c) => !c.parentId);
  const replies = (id: string) => a.commentsList.filter((c) => c.parentId === id);

  const comment = (c: ArticleComment, reply: boolean) => (
    <div className="flex gap-3">
      <Avatar name={c.authorName} size="sm" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs text-muted">
          <Name name={c.authorName} handle={c.authorHandle} /> · {formatDateTime(c.createdAt)}
          {c.authorId === a.authorId && <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">Author</span>}
        </p>
        <p className={c.removed ? "text-sm italic text-muted" : "whitespace-pre-line break-words text-sm"}>{c.body}</p>
        {viewer && !c.removed && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {c.mine && <ButtonForm action={deleteCommentAction.bind(null, a.id, c.id)} label="Delete" confirmMessage="Delete your comment?" />}
            {!c.mine && (
              <details>
                <summary className="cursor-pointer text-muted hover:text-fg">Report</summary>
                <div className="mt-2">
                  <ReportForm action={reportCommentAction.bind(null, c.id)} />
                </div>
              </details>
            )}
            {!reply && live && (
              <details>
                <summary className="cursor-pointer text-brand-600 hover:underline dark:text-brand-400">Reply</summary>
                <div className="mt-2">
                  <CommentForm action={commentAction.bind(null, a.id, c.id)} reply />
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/articles" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Articles
      </Link>
      {a.hidden && <Callout tone="warn">Hidden by the organizers after a report. Only you and the organizers can see it.</Callout>}
      {a.status === "DRAFT" && <Callout tone="info">This is a draft. Only you can see it until you publish it.</Callout>}

      <header className="space-y-3">
        {a.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {a.tags.map((t) => (
              <Link key={t} href={`/articles?tag=${encodeURIComponent(t)}`} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted hover:text-fg">
                {t}
              </Link>
            ))}
          </div>
        )}
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">{a.title}</h1>
        <p className="text-lg text-muted">{a.summary}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Avatar name={a.author.name} size="sm" />
          <Name name={a.author.name} handle={a.author.handle} />
          {a.publishedAt && <span>{formatDate(a.publishedAt)}</span>}
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden /> {a.readingMinutes} min read
          </span>
          {a.reviewsList.length > 0 && (
            <a href="#reviews" className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
              <BadgeCheck className="size-4" aria-hidden /> Reviewed
            </a>
          )}
        </div>
      </header>

      {a.hasCover && live && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/articles/${a.id}/cover`} alt="" className="max-h-[420px] w-full rounded-xl border border-line object-cover" />
      )}
      {a.hasCover && !live && <p className="text-xs text-muted">The cover picture shows once the article is published.</p>}

      <Markdown source={a.body} />

      {/* What readers can do */}
      <div className="flex flex-wrap items-center gap-3 border-y border-line py-4">
        {viewer && !a.mine && live ? (
          <ButtonForm
            action={usefulArticleAction.bind(null, a.id)}
            variant={a.markedUseful ? "primary" : "secondary"}
            label={
              <>
                <Hand className="size-4" aria-hidden /> {a.markedUseful ? "Useful to you" : "Useful"} · {a.useful}
              </>
            }
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <Hand className="size-4" aria-hidden /> {a.useful} found this useful
          </span>
        )}
        {viewer && live && (
          <ButtonForm
            action={bookmarkAction.bind(null, a.id)}
            label={
              <>
                <Bookmark className="size-4" aria-hidden fill={a.bookmarked ? "currentColor" : "none"} /> {a.bookmarked ? "Saved" : "Save for later"}
              </>
            }
          />
        )}
        {!viewer && (
          <Link href="/sign-in" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
            Sign in to mark it useful, comment or repost
          </Link>
        )}
        {a.mine && (
          <>
            <Link href={`/community/articles/${a.id}/edit`} className={buttonClass("secondary", "sm")}>
              Edit
            </Link>
            {!a.hidden && (
              <ButtonForm
                action={publishAction.bind(null, a.id, a.status !== "PUBLISHED")}
                label={a.status === "PUBLISHED" ? "Back to draft" : "Publish"}
                variant={a.status === "PUBLISHED" ? "secondary" : "primary"}
                confirmMessage={a.status === "PUBLISHED" ? "Take it off the feed? Only you will see it until you publish it again." : undefined}
              />
            )}
            <ButtonForm action={removeArticleAction.bind(null, a.id)} label="Delete" variant="danger" confirmMessage="Delete this article for good?" />
          </>
        )}
        {a.organizer && a.hidden && <ButtonForm action={unhideArticleAction.bind(null, a.id)} label="Show again" />}
      </div>

      {viewer && !a.mine && live && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title={a.reposted ? "You reposted this" : "Repost"} description={a.reposted ? undefined : "Share it on your profile and the feed, with a note."}>
            <RepostForm action={repostAction.bind(null, a.id)} reposted={a.reposted} />
          </Card>
          {a.canReview && !a.reviewedByMe && (
            <Card title="Review this article" description="You have the Reviewer badge. A review tells readers someone checked it.">
              <ArticleReviewForm action={reviewArticleAction.bind(null, a.id)} />
            </Card>
          )}
        </div>
      )}

      {a.reviewsList.length > 0 && (
        <section id="reviews" className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BadgeCheck className="size-5 text-emerald-600" aria-hidden /> Reviewed by
          </h2>
          <ul className="space-y-3">
            {a.reviewsList.map((r, i) => (
              <li key={i} className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                <p className="text-xs text-muted">
                  <Name name={r.reviewerName} handle={r.reviewerHandle} /> · Reviewer · {formatDate(r.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-line break-words">{r.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {a.repostsList.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted">
            <Repeat2 className="size-4" aria-hidden /> Reposted by {a.repostsList.length}
          </h2>
          <ul className="space-y-1.5 text-sm">
            {a.repostsList.map((r, i) => (
              <li key={i}>
                <Name name={r.name} handle={r.handle} />
                {r.note && <span className="text-muted">: {r.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="comments" className="space-y-4">
        <h2 className="text-lg font-semibold">Comments ({a.comments})</h2>
        {viewer && live && <CommentForm action={commentAction.bind(null, a.id, null)} />}
        {top.length === 0 ? (
          <p className="text-sm text-muted">No comments yet.</p>
        ) : (
          <ul className="space-y-5">
            {top.map((c) => (
              <li key={c.id} className="space-y-3">
                {comment(c, false)}
                {replies(c.id).length > 0 && (
                  <ul className="ml-4 space-y-3 border-l-2 border-line pl-4 sm:ml-10">
                    {replies(c.id).map((r) => (
                      <li key={r.id}>{comment(r, true)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewer && !a.mine && live && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">Report this article</summary>
          <div className="mt-2">
            <ReportForm action={reportArticleAction.bind(null, a.id)} />
          </div>
        </details>
      )}
    </div>
  );
}
