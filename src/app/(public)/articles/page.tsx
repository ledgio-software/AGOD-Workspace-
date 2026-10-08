import type { Metadata } from "next";
import Link from "next/link";
import { Newspaper, PenLine } from "lucide-react";
import { inputClass } from "@/components/input-class";
import { EmptyState, buttonClass, cx } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { articleFeed, articleTags } from "@/modules/community/articles";
import { ArticleCard } from "./article-card";

export const metadata: Metadata = { title: "Articles" };

// Phase 37: articles by members: what they built, how, and what they learned. Anyone can read.

const SORTS = [
  { key: undefined, label: "Latest" },
  { key: "useful", label: "Most useful" },
  { key: "reviewed", label: "Reviewed" },
] as const;

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ sort?: string; tag?: string; q?: string }> }) {
  const viewer = await getSignedIn();
  const params = await searchParams;
  const [feed, tags] = await Promise.all([articleFeed(params), articleTags()]);
  const qs = (patch: Record<string, string | undefined>) => {
    const merged = { ...params, ...patch };
    const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `/articles?${s}` : "/articles";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Articles</h1>
          <p className="max-w-2xl text-sm text-muted">How members built things, what went wrong and what they learned. Read, comment, and repost what helped you.</p>
        </div>
        {viewer ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/community/articles" className={buttonClass("secondary")}>
              My articles
            </Link>
            <Link href="/community/articles/new" className={buttonClass("primary")}>
              <PenLine className="size-4" aria-hidden /> Write an article
            </Link>
          </div>
        ) : signupOpen() ? (
          <Link href="/sign-up" className={buttonClass("primary")}>
            Join to write
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Sort" className="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          {SORTS.map((s) => (
            <Link
              key={s.label}
              href={qs({ sort: s.key })}
              aria-current={(params.sort ?? undefined) === s.key ? "page" : undefined}
              className={cx("rounded-md px-3 py-1.5", (params.sort ?? undefined) === s.key ? "bg-surface font-medium text-fg shadow-xs" : "text-muted hover:text-fg")}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <form className="flex min-w-60 flex-1 gap-2" role="search">
          {params.sort && <input type="hidden" name="sort" value={params.sort} />}
          {params.tag && <input type="hidden" name="tag" value={params.tag} />}
          <input name="q" defaultValue={params.q} placeholder="Search articles" aria-label="Search articles" className={inputClass} />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const on = params.tag?.toLowerCase() === t.toLowerCase();
            return (
              <Link key={t} href={qs({ tag: on ? undefined : t })} className={cx("rounded-full px-2.5 py-0.5 text-xs", on ? "bg-brand-600 text-white" : "bg-surface-muted text-muted hover:text-fg")}>
                {t}
              </Link>
            );
          })}
        </div>
      )}

      {feed.length === 0 ? (
        <EmptyState icon={Newspaper} title={params.q || params.tag ? "No articles match" : "No articles yet"}>
          {viewer ? "Write about something you built. Others learn from it." : "Members write about what they built and learned here."}
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {feed.map((item) => (
            <li key={item.kind === "repost" ? `r-${item.article.id}-${item.by.name}-${item.at.getTime()}` : item.article.id}>
              <ArticleCard article={item.article} repost={item.kind === "repost" ? { ...item.by, note: item.note } : undefined} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
