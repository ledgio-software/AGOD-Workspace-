import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus, Star, ThumbsUp, Wifi } from "lucide-react";
import { Badge } from "@/components/badges";
import { inputClass } from "@/components/input-class";
import { EmptyState, buttonClass, cx } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { LIBRARY_KINDS, libraryTags, listItems } from "@/modules/community/library";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata("Tools & prompts", "AI tools, prompts that worked and guides shared by Ghana's builders, including ones that work on a slow or costly connection.");

// Phase 31: the tools & prompts library: what members found useful, most useful first.

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ kind?: string; tag?: string; q?: string; sort?: string; lowData?: string }> }) {
  const viewer = await getSignedIn();
  const params = await searchParams;
  const [items, tags] = await Promise.all([listItems(viewer, { ...params, lowData: params.lowData === "1" }), libraryTags()]);
  const qs = (patch: Record<string, string | undefined>) => {
    const merged = { ...params, ...patch };
    const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `/library?${s}` : "/library";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tools &amp; prompts</h1>
          <p className="max-w-2xl text-sm text-muted">Tools, prompts that worked and guides, shared by members. Mark what helped you so the best rise to the top.</p>
        </div>
        {viewer ? (
          <Link href="/community/library/new" className={buttonClass("primary")}>
            <Plus className="size-4" aria-hidden /> Share something
          </Link>
        ) : signupOpen() ? (
          <Link href="/sign-up" className={buttonClass("primary")}>
            Join to share
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Kinds" className="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          {[{ key: undefined, label: "All" }, ...Object.entries(LIBRARY_KINDS).map(([key, label]) => ({ key, label: `${label}s` }))].map((k) => (
            <Link
              key={k.label}
              href={qs({ kind: k.key })}
              className={cx("rounded-md px-3 py-1.5", (params.kind ?? undefined) === k.key ? "bg-surface font-medium text-fg shadow-xs" : "text-muted hover:text-fg")}
            >
              {k.label}
            </Link>
          ))}
        </nav>
        <form className="flex min-w-60 flex-1 gap-2" role="search">
          {params.kind && <input type="hidden" name="kind" value={params.kind} />}
          <input name="q" defaultValue={params.q} placeholder="Search" aria-label="Search the library" className={inputClass} />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
        <Link href={qs({ lowData: params.lowData === "1" ? undefined : "1" })} className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm", params.lowData === "1" ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "border-line text-muted")}>
          <Wifi className="size-3.5" aria-hidden /> Works on slow internet
        </Link>
        <Link href={qs({ sort: params.sort === "new" ? undefined : "new" })} className="text-sm text-brand-600 hover:underline dark:text-brand-400">
          {params.sort === "new" ? "Most useful first" : "Newest first"}
        </Link>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Link key={t} href={qs({ tag: params.tag?.toLowerCase() === t.toLowerCase() ? undefined : t })} className={cx("rounded-full px-2.5 py-0.5 text-xs", params.tag?.toLowerCase() === t.toLowerCase() ? "bg-brand-600 text-white" : "bg-surface-muted text-muted hover:text-fg")}>
              {t}
            </Link>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nothing here yet">
          {viewer ? "Share a tool or a prompt that helped you." : "Members share tools and prompts here."}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={`/library/${i.id}`} className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-5 shadow-xs hover:border-brand-500">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={i.kind === "PROMPT" ? "violet" : i.kind === "TOOL" ? "blue" : "green"}>{LIBRARY_KINDS[i.kind]}</Badge>
                  {i.featured && (
                    <Badge tone="amber">
                      <Star className="mr-1 inline size-3" aria-hidden />
                      Featured
                    </Badge>
                  )}
                  {i.lowData && <Badge>Low data</Badge>}
                  {i.free && <Badge>Free</Badge>}
                </div>
                <p className="font-medium">{i.title}</p>
                <p className="flex-1 text-sm text-muted">{i.summary}</p>
                <p className="flex items-center justify-between text-xs text-muted">
                  <span>by {i.authorName}</span>
                  <span className="inline-flex items-center gap-1">
                    <ThumbsUp className="size-3.5" aria-hidden /> {i.useful}
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
