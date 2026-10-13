import { type Member, listMembers } from "./index";
import { articleFeed } from "./articles";
import { JOB_KINDS, WORK_MODES, listJobs } from "./jobs";
import { LIBRARY_KINDS, listItems } from "./library";
import { NEWS_TOPICS, newsFeed } from "./news";
import { listSessions } from "./sessions";
import { listPosts } from "./showcase";
import { TEAM_KINDS, listTeamPosts } from "./teams";

// Phase 39: one search box for the whole community. Each section is searched with the same list
// function its own page uses, with the same viewer, so search shows exactly what that person could
// find there: visitors see public profiles only, nobody sees hidden or removed posts, closed jobs
// are left out. Each group shows the first few matches and links to its page for the rest.

export const MIN_QUERY = 2;
const PER_GROUP = 5;

export type SearchHit = { href: string; title: string; snippet: string | null; meta: string | null; external?: boolean };
export type SearchGroup = { key: string; label: string; hits: SearchHit[]; more: boolean; seeAll: string };

const cut = (text: string | null | undefined, max = 160) => (text ? (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text) : null);
const pick = <T>(rows: T[]) => ({ rows: rows.slice(0, PER_GROUP), more: rows.length > PER_GROUP });

export async function searchCommunity(viewer: Member | null, raw: string): Promise<SearchGroup[]> {
  const q = raw.trim().slice(0, 60);
  if (q.length < MIN_QUERY) return [];
  const enc = encodeURIComponent(q);
  const [members, posts, articles, jobs, upcoming, past, items, teams, news] = await Promise.all([
    listMembers(viewer, { q }),
    listPosts(viewer, { q }),
    articleFeed({ q }),
    listJobs({ q }),
    listSessions("upcoming", { q, limit: PER_GROUP + 1 }),
    listSessions("past", { q, limit: PER_GROUP + 1 }),
    listItems(viewer, { q }),
    listTeamPosts({ q }),
    newsFeed(viewer, { q }),
  ]);

  const m = pick(members.members);
  const p = pick(posts.posts);
  // The feed can list an article twice (it and a repost); search lists each once.
  const a = pick([...new Map(articles.map((i) => [i.article.id, i.article])).values()]);
  const j = pick(jobs);
  const s = pick([...upcoming.sessions, ...past.sessions]);
  const l = pick(items);
  const t = pick(teams);
  const n = pick(news);
  const now = new Date();

  const groups: SearchGroup[] = [
    {
      key: "members",
      label: "Members",
      hits: m.rows.filter((r) => r.handle).map((r) => ({ href: `/members/${r.handle}`, title: r.name, snippet: cut(r.headline), meta: [r.city, r.tools.slice(0, 3).join(", ")].filter(Boolean).join(" · ") || null })),
      more: m.more || members.more,
      seeAll: `/members?q=${enc}`,
    },
    {
      key: "showcase",
      label: "Projects",
      hits: p.rows.map((r) => ({ href: `/showcase/${r.id}`, title: r.title, snippet: cut(r.pitch), meta: `by ${r.authorName}` })),
      more: p.more || posts.more,
      seeAll: `/showcase?q=${enc}`,
    },
    {
      key: "articles",
      label: "Articles",
      hits: a.rows.map((r) => ({ href: `/articles/${r.id}`, title: r.title, snippet: cut(r.summary), meta: `by ${r.author.name} · ${r.readingMinutes} min read` })),
      more: a.more,
      seeAll: `/articles?q=${enc}`,
    },
    {
      key: "jobs",
      label: "Jobs & gigs",
      hits: j.rows.map((r) => ({ href: `/jobs/${r.id}`, title: r.title, snippet: null, meta: [r.hirer, JOB_KINDS[r.kind], WORK_MODES[r.workMode], r.location].filter(Boolean).join(" · ") })),
      more: j.more,
      seeAll: `/jobs?q=${enc}`,
    },
    {
      key: "sessions",
      label: "Sessions",
      hits: s.rows.map((r) => ({ href: `/sessions/${r.id}`, title: r.title, snippet: r.topics.length ? r.topics.join(", ") : null, meta: `${r.endsAt > now ? "Upcoming" : "Past"} · hosted by ${r.hostName}` })),
      more: s.more || upcoming.more || past.more,
      seeAll: "/sessions",
    },
    {
      key: "library",
      label: "Tools & prompts",
      hits: l.rows.map((r) => ({ href: `/library/${r.id}`, title: r.title, snippet: cut(r.summary), meta: LIBRARY_KINDS[r.kind] })),
      more: l.more,
      seeAll: `/library?q=${enc}`,
    },
    {
      key: "teams",
      label: "Team finder",
      hits: t.rows.map((r) => ({ href: `/teams/${r.id}`, title: r.title, snippet: r.roles.length ? `Roles: ${r.roles.join(", ")}` : null, meta: TEAM_KINDS[r.kind] })),
      more: t.more,
      seeAll: `/teams?q=${enc}`,
    },
    {
      key: "news",
      label: "Tech news",
      hits: n.rows.map((r) => ({ href: r.url, title: r.title, snippet: cut(r.summary), meta: `${r.source.name} · ${NEWS_TOPICS[r.topic]}`, external: true })),
      more: n.more,
      seeAll: `/news?q=${enc}`,
    },
  ];
  return groups.filter((g) => g.hits.length > 0);
}
