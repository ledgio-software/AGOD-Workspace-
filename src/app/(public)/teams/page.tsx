import type { Metadata } from "next";
import Link from "next/link";
import { Plus, UsersRound } from "lucide-react";
import { Badge } from "@/components/badges";
import { inputClass } from "@/components/input-class";
import { EmptyState, buttonClass, cx } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { REWARDS, TEAM_KINDS, listTeamPosts } from "@/modules/community/teams";

export const metadata: Metadata = { title: "Team finder" };

// Phase 33: the team finder. Ideas that need people, and people looking for a team.

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ kind?: string; role?: string; q?: string }> }) {
  const viewer = await getSignedIn();
  const params = await searchParams;
  const posts = await listTeamPosts(params);
  const qs = (patch: Record<string, string | undefined>) => {
    const merged = { ...params, ...patch };
    const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `/teams?${s}` : "/teams";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team finder</h1>
          <p className="max-w-2xl text-sm text-muted">Have an idea and need a designer or a developer? Want to join a team and build something real? Find each other here.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewer && (
            <Link href="/community/teams" className={buttonClass("secondary")}>
              My posts &amp; requests
            </Link>
          )}
          {viewer ? (
            <Link href="/community/teams/new" className={buttonClass("primary")}>
              <Plus className="size-4" aria-hidden /> Post
            </Link>
          ) : signupOpen() ? (
            <Link href="/sign-up" className={buttonClass("primary")}>
              Join to take part
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Kind" className="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          {[{ key: undefined, label: "All" }, ...Object.entries(TEAM_KINDS).map(([key, label]) => ({ key, label }))].map((k) => (
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
          <input name="q" defaultValue={params.q} placeholder="Search: role, tool, idea" aria-label="Search the team finder" className={inputClass} />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
      </div>
      {params.role && (
        <p className="text-sm text-muted">
          Role or tool: <strong>{params.role}</strong>{" "}
          <Link href={qs({ role: undefined })} className="text-brand-600 hover:underline dark:text-brand-400">
            Clear
          </Link>
        </p>
      )}

      {posts.length === 0 ? (
        <EmptyState icon={UsersRound} title="Nothing here yet">
          {viewer ? "Post your idea, or say you're looking for a team." : "Members post ideas and look for teammates here."}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={`/teams/${p.id}`} className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-5 shadow-xs hover:border-brand-500">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={p.kind === "IDEA" ? "violet" : "blue"}>{TEAM_KINDS[p.kind]}</Badge>
                  <Badge>{REWARDS[p.reward]}</Badge>
                </div>
                <p className="font-medium">{p.title}</p>
                <p className="line-clamp-2 text-sm text-muted">{p.description}</p>
                <p className="text-sm">
                  <span className="text-muted">{p.kind === "IDEA" ? "Needs: " : "Can be: "}</span>
                  {p.roles.join(", ")}
                </p>
                <p className="mt-auto text-xs text-muted">
                  {p.authorName}
                  {p.authorCity ? ` · ${p.authorCity}` : ""} · {p.commitment}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
