import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { listMembers } from "@/modules/community";
import { publishedArticles } from "@/modules/community/articles";
import { listJobs } from "@/modules/community/jobs";
import { listItems } from "@/modules/community/library";
import { listSessions } from "@/modules/community/sessions";
import { listPosts } from "@/modules/community/showcase";
import { listTeamPosts } from "@/modules/community/teams";

// Phase 39: every public page for search engines. Each list comes from the same functions the
// public pages use with no viewer, so only what a visitor may see is listed (public profiles,
// published articles, visible projects, open jobs...). Built on request (it reads the database).
export const dynamic = "force-dynamic";

const PAGES = 50; // at most this many pages of each paged list

async function pages<T>(load: (page: number) => Promise<{ items: T[]; more: boolean }>): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const { items, more } = await load(page);
    all.push(...items);
    if (!more) break;
  }
  return all;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl() ?? "";
  const url = (path: string) => `${base}${path}`;
  const now = new Date();
  const fixed: MetadataRoute.Sitemap = [
    { url: url("/"), changeFrequency: "daily", priority: 1 },
    { url: url("/news"), changeFrequency: "hourly", priority: 0.8 },
    { url: url("/articles"), changeFrequency: "daily", priority: 0.8 },
    { url: url("/showcase"), changeFrequency: "daily", priority: 0.8 },
    { url: url("/jobs"), changeFrequency: "daily", priority: 0.8 },
    { url: url("/sessions"), changeFrequency: "daily", priority: 0.7 },
    { url: url("/library"), changeFrequency: "weekly", priority: 0.7 },
    { url: url("/mentors"), changeFrequency: "weekly", priority: 0.6 },
    { url: url("/teams"), changeFrequency: "weekly", priority: 0.6 },
    { url: url("/members"), changeFrequency: "weekly", priority: 0.6 },
    { url: url("/code-of-conduct"), changeFrequency: "yearly", priority: 0.3 },
  ].map((e) => ({ ...e, lastModified: now }) as MetadataRoute.Sitemap[number]);

  try {
    const [articles, members, posts, upcoming, past, items, jobs, teams] = await Promise.all([
      publishedArticles(),
      pages(async (page) => {
        const r = await listMembers(null, { page });
        return { items: r.members, more: r.more };
      }),
      pages(async (page) => {
        const r = await listPosts(null, { page });
        return { items: r.posts, more: r.more };
      }),
      pages(async (page) => {
        const r = await listSessions("upcoming", { page, limit: 60 });
        return { items: r.sessions, more: r.more };
      }),
      pages(async (page) => {
        const r = await listSessions("past", { page, limit: 60 });
        return { items: r.sessions, more: r.more };
      }),
      listItems(null, { sort: "new" }),
      listJobs(),
      listTeamPosts(),
    ]);
    return [
      ...fixed,
      ...articles.map((a) => ({ url: url(`/articles/${a.id}`), lastModified: a.at, changeFrequency: "weekly" as const, priority: 0.7 })),
      ...posts.map((p) => ({ url: url(`/showcase/${p.id}`), lastModified: p.createdAt, changeFrequency: "weekly" as const, priority: 0.6 })),
      ...jobs.map((j) => ({ url: url(`/jobs/${j.id}`), lastModified: j.createdAt, changeFrequency: "daily" as const, priority: 0.6 })),
      ...[...upcoming, ...past].map((s) => ({ url: url(`/sessions/${s.id}`), lastModified: s.startsAt < now ? s.startsAt : now, changeFrequency: "weekly" as const, priority: 0.5 })),
      ...items.map((i) => ({ url: url(`/library/${i.id}`), lastModified: i.createdAt, changeFrequency: "monthly" as const, priority: 0.5 })),
      ...teams.map((t) => ({ url: url(`/teams/${t.id}`), lastModified: t.createdAt, changeFrequency: "weekly" as const, priority: 0.4 })),
      ...members.filter((m) => m.handle).map((m) => ({ url: url(`/members/${m.handle}`), changeFrequency: "monthly" as const, priority: 0.4 })),
    ];
  } catch (error) {
    // The fixed pages still help if the database can't be reached.
    console.error("Sitemap: listing pages failed", error instanceof Error ? error.message : error);
    return fixed;
  }
}
