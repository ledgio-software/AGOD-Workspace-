import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { inputClass } from "@/components/form";
import { buttonClass, cx } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { listPosts } from "@/modules/community/showcase";
import { PostGrid } from "./post-grid";

export const metadata: Metadata = { title: "Showcase" };

const TABS = [
  { status: "", label: "All projects" },
  { status: "NEEDS_REVIEW", label: "Needs review" },
  { status: "SHIPPED", label: "Shipped" },
] as const;

export default async function ShowcasePage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const viewer = await getSignedIn();
  const params = await searchParams;
  const status = TABS.some((t) => t.status === params.status) ? (params.status ?? "") : "";
  const page = Number(params.page) || 1;
  const { posts, more } = await listPosts(viewer, { status: status || undefined, q: params.q, page, order: status === "NEEDS_REVIEW" ? "needs-review" : "new" });
  const query = (extra: Record<string, string>) => new URLSearchParams({ ...(status ? { status } : {}), ...(params.q ? { q: params.q } : {}), ...extra }).toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Showcase</h1>
          <p className="text-sm text-muted">What people in the community are building. Try it, and give honest, kind feedback.</p>
        </div>
        {viewer ? (
          <Link href="/community/showcase/new" className={buttonClass("primary")}>
            <Plus className="size-4" aria-hidden /> Share a project
          </Link>
        ) : signupOpen() ? (
          <Link href="/sign-up" className={buttonClass("primary")}>
            Join to share yours
          </Link>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter" className="flex flex-wrap gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          {TABS.map((t) => (
            <Link
              key={t.label}
              href={`/showcase${t.status ? `?status=${t.status}` : ""}`}
              aria-current={t.status === status ? "page" : undefined}
              className={cx("rounded-md px-3 py-1.5", t.status === status ? "bg-surface font-medium text-fg shadow-xs" : "text-muted hover:text-fg")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form role="search" className="flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={params.q ?? ""} placeholder="Search projects or tools" aria-label="Search projects" className={`${inputClass} w-56`} />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
      </div>
      <PostGrid posts={posts} empty={status === "NEEDS_REVIEW" ? "Nobody is waiting for feedback right now." : "No projects yet. Be the first to share one!"} />
      {more && (
        <Link href={`/showcase?${query({ page: String(page + 1) })}`} className={buttonClass("secondary", "sm")}>
          More projects
        </Link>
      )}
    </div>
  );
}
