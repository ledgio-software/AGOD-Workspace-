import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, Search } from "lucide-react";
import { inputClass } from "@/components/input-class";
import { EmptyState, buttonClass } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { pageMetadata } from "@/lib/site";
import { MIN_QUERY, searchCommunity } from "@/modules/community/search";

// Phase 39: one search box for the whole community: members, projects, articles, jobs, sessions,
// tools & prompts, team finder posts and tech news, grouped by kind. Anyone can search; visitors
// find what visitors can see. Results pages aren't indexed (they'd be duplicates of the sections).

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<Metadata> {
  const q = (await searchParams).q?.trim();
  return {
    ...pageMetadata(q ? `Search: ${q.slice(0, 60)}` : "Search", "Search members, projects, articles, jobs, sessions, tools & prompts and tech news."),
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const viewer = await getSignedIn();
  const q = ((await searchParams).q ?? "").trim().slice(0, 60);
  const groups = await searchCommunity(viewer, q);
  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted">Members, projects, articles, jobs, sessions, tools & prompts, team finder posts and tech news, all at once.</p>
      </div>
      <form role="search" action="/search" className="flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          autoFocus={!q}
          minLength={MIN_QUERY}
          maxLength={60}
          placeholder="e.g. Lovable, payments, Kumasi, internship"
          aria-label="Search the community"
          className={inputClass}
        />
        <button type="submit" className={buttonClass("primary")}>
          <Search className="size-4" aria-hidden /> Search
        </button>
      </form>

      {q.length > 0 && q.length < MIN_QUERY ? (
        <p className="text-sm text-muted">Type at least {MIN_QUERY} letters.</p>
      ) : q && total === 0 ? (
        <EmptyState icon={Search} title={`Nothing found for “${q}”`}>
          Try a shorter word, a tool (like “Supabase”) or a city.
        </EmptyState>
      ) : (
        groups.length > 0 && (
          <div className="space-y-8">
            <nav aria-label="Jump to" className="flex flex-wrap gap-1.5 text-xs">
              {groups.map((g) => (
                <a key={g.key} href={`#${g.key}`} className="rounded-full bg-surface-muted px-2.5 py-1 text-muted hover:text-fg">
                  {g.label} · {g.hits.length}
                  {g.more ? "+" : ""}
                </a>
              ))}
            </nav>
            {groups.map((g) => (
              <section key={g.key} id={g.key} aria-labelledby={`${g.key}-title`} className="scroll-mt-24 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id={`${g.key}-title`} className="text-sm font-semibold uppercase tracking-wide text-muted">
                    {g.label}
                  </h2>
                  <Link href={g.seeAll} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
                    {g.more ? "See all" : "Open"} <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
                  {g.hits.map((h) => (
                    <li key={h.href}>
                      {h.external ? (
                        <a href={h.href} target="_blank" rel="noopener noreferrer nofollow" className="block space-y-1 p-4 hover:bg-surface-muted/50">
                          <Hit title={h.title} snippet={h.snippet} meta={h.meta} external />
                        </a>
                      ) : (
                        <Link href={h.href} className="block space-y-1 p-4 hover:bg-surface-muted/50">
                          <Hit title={h.title} snippet={h.snippet} meta={h.meta} />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function Hit({ title, snippet, meta, external }: { title: string; snippet: string | null; meta: string | null; external?: boolean }) {
  return (
    <>
      <p className="font-medium leading-snug">
        {title}
        {external && <ExternalLink className="ml-1 inline size-3.5 align-baseline text-muted" aria-label="(opens the original site)" />}
      </p>
      {snippet && <p className="line-clamp-2 text-sm text-muted">{snippet}</p>}
      {meta && <p className="text-xs text-muted">{meta}</p>}
    </>
  );
}
