import Link from "next/link";
import { BadgeCheck, Clock, Hand, MessageSquare, Repeat2 } from "lucide-react";
import { formatDate } from "@/lib/dates";
import type { ArticleCard as Card } from "@/modules/community/articles";

// Phase 37: an article on the feed, a profile or a reading list.

export function ArticleCard({ article: a, repost }: { article: Card; repost?: { name: string; handle: string | null; note: string | null } }) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      {repost && (
        <div className="space-y-1 border-b border-line bg-surface-muted px-5 py-2.5 text-sm">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Repeat2 className="size-3.5" aria-hidden />
            {repost.handle ? (
              <Link href={`/members/${repost.handle}`} className="font-medium text-fg hover:underline">
                {repost.name}
              </Link>
            ) : (
              <span className="font-medium text-fg">{repost.name}</span>
            )}{" "}
            reposted
          </p>
          {repost.note && <p className="break-words">{repost.note}</p>}
        </div>
      )}
      <Link href={`/articles/${a.id}`} className="flex flex-col gap-4 p-5 hover:bg-surface-muted/50 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-muted">
            {a.author.name}
            {a.publishedAt && <> · {formatDate(a.publishedAt)}</>}
          </p>
          <h2 className="text-lg font-semibold leading-snug tracking-tight">{a.title}</h2>
          <p className="line-clamp-3 text-sm text-muted">{a.summary}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden /> {a.readingMinutes} min read
            </span>
            <span className="inline-flex items-center gap-1" title="Found it useful">
              <Hand className="size-3.5" aria-hidden /> {a.useful}
            </span>
            <span className="inline-flex items-center gap-1" title="Comments">
              <MessageSquare className="size-3.5" aria-hidden /> {a.comments}
            </span>
            {a.reviews > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                <BadgeCheck className="size-3.5" aria-hidden /> Reviewed
              </span>
            )}
            {a.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full bg-surface-muted px-2 py-0.5">
                {t}
              </span>
            ))}
          </div>
        </div>
        {a.hasCover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/articles/${a.id}/cover`} alt="" loading="lazy" className="aspect-video w-full rounded-lg object-cover sm:h-28 sm:w-44 sm:shrink-0" />
        )}
      </Link>
    </article>
  );
}
