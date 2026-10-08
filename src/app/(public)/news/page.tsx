import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { ExternalLink, Hand, MessageSquare, Newspaper, Settings2, TrendingUp } from "lucide-react";
import { inputClass } from "@/components/input-class";
import { EmptyState, buttonClass, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { getSignedIn } from "@/lib/session";
import { canModerate } from "@/modules/community";
import { NEWS_TOPICS, type NewsItem, newsFeed, newsUpdatedAt, refreshNews } from "@/modules/community/news";
import { hideNewsAction, usefulNewsAction } from "../../(community)/community/news-actions";
import { ButtonForm } from "../../(community)/community/growth-forms";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata("Tech news", "Headlines on African tech, AI, programming and new releases, updated every few hours.");
// Fetching the sources after the page is sent can take a few seconds.
export const maxDuration = 60;

// Phase 38: tech news from free public sources (Africa tech, AI, programming, releases), fetched
// every few hours. Anyone can read; members mark what's useful, which makes "Top this week".

const TABS = [{ key: undefined, label: "All" }, ...Object.entries(NEWS_TOPICS).map(([key, label]) => ({ key, label }))];

function ago(date: Date): string {
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ topic?: string; q?: string; sort?: string }> }) {
  const viewer = await getSignedIn();
  const params = await searchParams;
  // Headlines older than a few hours are fetched again once this page has been sent, so nobody
  // waits for the sources; the next visitor sees the new headlines.
  after(() => refreshNews().catch((error) => console.error("News refresh failed", error instanceof Error ? error.message : error)));
  const [items, updatedAt, organizer] = await Promise.all([newsFeed(viewer, params), newsUpdatedAt(), viewer ? canModerate(viewer) : false]);
  const top = params.sort === "top";
  const qs = (patch: Record<string, string | undefined>) => {
    const merged = { ...params, ...patch };
    const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `/news?${s}` : "/news";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tech news</h1>
          <p className="max-w-2xl text-sm text-muted">
            Headlines on African tech, AI, programming and new releases, from sites we trust. Open one to read it on its own site.
            {updatedAt && <> Updated {ago(updatedAt)}.</>}
          </p>
        </div>
        {organizer && (
          <Link href="/community/news" className={buttonClass("secondary")}>
            <Settings2 className="size-4" aria-hidden /> Sources
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Topic" className="flex flex-wrap gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          <Link
            href={qs({ sort: top ? undefined : "top", topic: undefined })}
            aria-current={top ? "page" : undefined}
            className={cx("inline-flex items-center gap-1 rounded-md px-3 py-1.5", top ? "bg-surface font-medium text-fg shadow-xs" : "text-muted hover:text-fg")}
          >
            <TrendingUp className="size-3.5" aria-hidden /> Top this week
          </Link>
          {TABS.map((t) => {
            const on = !top && (params.topic ?? undefined) === t.key;
            return (
              <Link
                key={t.label}
                href={qs({ topic: t.key, sort: undefined })}
                aria-current={on ? "page" : undefined}
                className={cx("rounded-md px-3 py-1.5", on ? "bg-surface font-medium text-fg shadow-xs" : "text-muted hover:text-fg")}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <form className="flex min-w-60 flex-1 gap-2" role="search">
          {params.topic && <input type="hidden" name="topic" value={params.topic} />}
          <input name="q" defaultValue={params.q} placeholder="Search headlines" aria-label="Search headlines" className={inputClass} />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Newspaper} title={params.q ? "No headlines match" : top ? "Nothing marked useful this week yet" : "No headlines yet"}>
          {top ? "When members mark headlines useful, the most useful ones show here." : updatedAt ? "Try another topic or search." : "The first headlines are on their way. Check back in a minute."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          {items.map((item) => (
            <li key={item.id}>
              <Headline item={item} signedIn={!!viewer} organizer={organizer} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Headlines and short summaries link to the original publishers, who own them.</p>
    </div>
  );
}

function Headline({ item, signedIn, organizer }: { item: NewsItem; signedIn: boolean; organizer: boolean }) {
  return (
    <article className={cx("space-y-2 p-4 sm:p-5", item.hidden && "opacity-60")}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <a href={item.source.site} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-fg hover:underline">
          {item.source.name}
        </a>
        <span aria-hidden>·</span>
        <time dateTime={item.publishedAt.toISOString()} title={formatDateTime(item.publishedAt)}>
          {ago(item.publishedAt)}
        </time>
        <span className="rounded-full bg-surface-muted px-2 py-0.5">{NEWS_TOPICS[item.topic]}</span>
        {item.hidden && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Hidden</span>}
      </p>
      <h2 className="text-base font-semibold leading-snug">
        <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
          {item.title}
          <ExternalLink className="ml-1 inline size-3.5 align-baseline text-muted" aria-label="(opens the original site)" />
        </a>
      </h2>
      {item.summary && <p className="line-clamp-2 text-sm text-muted">{item.summary}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        {signedIn && !item.hidden ? (
          <ButtonForm
            action={usefulNewsAction.bind(null, item.id)}
            variant={item.markedUseful ? "primary" : "secondary"}
            label={
              <>
                <Hand className="size-3.5" aria-hidden /> {item.markedUseful ? "Useful to you" : "Useful"} · {item.useful}
              </>
            }
          />
        ) : (
          <span className="inline-flex items-center gap-1" title="Members who found it useful">
            <Hand className="size-3.5" aria-hidden /> {item.useful}
          </span>
        )}
        {item.points !== null && <span title="Points where it was posted">{item.points} points</span>}
        {item.discussionUrl && (
          <a href={item.discussionUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-fg hover:underline">
            <MessageSquare className="size-3.5" aria-hidden /> {item.comments ?? 0} comments on {item.source.name}
          </a>
        )}
        {organizer && (
          <ButtonForm
            action={hideNewsAction.bind(null, item.id, !item.hidden)}
            label={item.hidden ? "Show again" : "Hide"}
            confirmMessage={item.hidden ? undefined : "Hide this headline from everyone?"}
          />
        )}
      </div>
    </article>
  );
}
