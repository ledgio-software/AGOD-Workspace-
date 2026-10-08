import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { newsItems, newsSources, newsUseful } from "@/lib/db/schema";
import { httpsLink, parseFeed, plainText } from "@/lib/feeds";
import { ServiceError } from "@/modules/errors";
import { type Member, canModerate } from "./index";

// Phase 38: tech news for the community. Headlines from free, public sources (RSS/Atom feeds, the
// Hacker News front page through Algolia's API, and DEV), fetched at most every few hours: when
// someone opens /news and the headlines are stale, and once a day from the cron job. Only the
// title, link and a short plain-text summary are kept; readers go to the original site to read.
// Members mark headlines useful ("Top this week"); organizers switch sources off and hide items.

export const NEWS_TOPICS = { AI: "AI", PROGRAMMING: "Programming", AFRICA: "Africa tech", RELEASES: "Releases", TECH: "Tech" } as const;
export type NewsTopic = keyof typeof NEWS_TOPICS;

type Source = { key: string; name: string; site: string; topic: NewsTopic } & ({ kind: "feed"; url: string } | { kind: "hn" } | { kind: "dev"; query: string });

/** The sources. To add one: a feed URL that returns RSS or Atom over https, and its main topic. */
export const NEWS_SOURCES: Source[] = [
  { key: "techcabal", name: "TechCabal", site: "https://techcabal.com", topic: "AFRICA", kind: "feed", url: "https://techcabal.com/feed/" },
  { key: "disrupt-africa", name: "Disrupt Africa", site: "https://disruptafrica.com", topic: "AFRICA", kind: "feed", url: "https://disruptafrica.com/feed/" },
  { key: "hacker-news", name: "Hacker News", site: "https://news.ycombinator.com", topic: "PROGRAMMING", kind: "hn" },
  { key: "dev-top", name: "DEV", site: "https://dev.to", topic: "PROGRAMMING", kind: "dev", query: "top=1&per_page=20" },
  { key: "dev-ai", name: "DEV", site: "https://dev.to", topic: "AI", kind: "dev", query: "tag=ai&top=7&per_page=15" },
  { key: "github-blog", name: "The GitHub Blog", site: "https://github.blog", topic: "PROGRAMMING", kind: "feed", url: "https://github.blog/feed/" },
  { key: "hugging-face", name: "Hugging Face", site: "https://huggingface.co/blog", topic: "AI", kind: "feed", url: "https://huggingface.co/blog/feed.xml" },
  { key: "simon-willison", name: "Simon Willison", site: "https://simonwillison.net", topic: "AI", kind: "feed", url: "https://simonwillison.net/atom/everything/" },
  { key: "techcrunch", name: "TechCrunch", site: "https://techcrunch.com", topic: "TECH", kind: "feed", url: "https://techcrunch.com/feed/" },
  { key: "the-verge", name: "The Verge", site: "https://www.theverge.com", topic: "TECH", kind: "feed", url: "https://www.theverge.com/rss/index.xml" },
  { key: "ars-technica", name: "Ars Technica", site: "https://arstechnica.com", topic: "TECH", kind: "feed", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
  { key: "mit-tech-review", name: "MIT Technology Review", site: "https://www.technologyreview.com", topic: "TECH", kind: "feed", url: "https://www.technologyreview.com/feed/" },
  { key: "nextjs", name: "Next.js", site: "https://nextjs.org/blog", topic: "RELEASES", kind: "feed", url: "https://nextjs.org/feed.xml" },
  { key: "vercel", name: "Vercel", site: "https://vercel.com/changelog", topic: "RELEASES", kind: "feed", url: "https://vercel.com/atom" },
];

const sourceByKey = new Map(NEWS_SOURCES.map((s) => [s.key, s]));

const STALE_HOURS = 3;
const KEEP_DAYS = 45;
// Older entries in a feed are skipped: the page is for what's new.
const MAX_AGE_DAYS = 14;
const PER_SOURCE = 20;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const USER_AGENT = "GhanaVibeCodersNews/1.0 (+https://github.com/ledgio-software)";

/** Headlines about AI from general sources go under AI too. */
// Acronyms match only in capitals ("AI", not "said"); words and names in any case.
const AI_ACRONYMS = /\b(AI|A\.I\.|LLMs?|GPT[-\w]*|AGI)\b/;
const AI_WORDS = /\b(ChatGPT|OpenAI|Anthropic|Claude|Gemini|DeepSeek|Llama|Mistral|machine learning|deep learning|neural networks?|Copilot|chatbots?|generative)\b/i;
export function topicFor(source: Pick<Source, "topic">, title: string): NewsTopic {
  return (source.topic === "TECH" || source.topic === "PROGRAMMING") && (AI_ACRONYMS.test(title) || AI_WORDS.test(title)) ? "AI" : source.topic;
}

type Entry = { title: string; url: string; summary: string | null; publishedAt: Date | null; points?: number; comments?: number; discussionUrl?: string | null };
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function getText(fetcher: Fetcher, url: string, accept: string): Promise<string> {
  const res = await fetcher(url, { headers: { "user-agent": USER_AGENT, accept }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) return res.text();
  // Some feeds carry whole articles and run to many megabytes; the newest entries come first, so
  // reading the start is enough (a cut-off last entry is simply not matched).
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
const str = (v: unknown) => (typeof v === "string" ? v : null);

async function entriesFor(source: Source, fetcher: Fetcher): Promise<Entry[]> {
  if (source.kind === "feed") return parseFeed(await getText(fetcher, source.url, "application/rss+xml, application/atom+xml, application/xml, text/xml"), PER_SOURCE);
  if (source.kind === "hn") {
    const data = JSON.parse(await getText(fetcher, `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${PER_SOURCE}`, "application/json")) as { hits?: unknown[] };
    return (data.hits ?? []).flatMap((h) => {
      const hit = h as Record<string, unknown>;
      const id = str(hit.objectID);
      const discussionUrl = id && /^\d+$/.test(id) ? `https://news.ycombinator.com/item?id=${id}` : null;
      // "Ask HN" posts have no link of their own: the discussion is the story.
      const url = httpsLink(str(hit.url)) ?? discussionUrl;
      const title = plainText(str(hit.title) ?? "", 200);
      if (!url || !title) return [];
      const created = str(hit.created_at);
      return [{ title, url, summary: null, publishedAt: created ? new Date(created) : null, points: num(hit.points), comments: num(hit.num_comments), discussionUrl }];
    });
  }
  const data = JSON.parse(await getText(fetcher, `https://dev.to/api/articles?${source.query}`, "application/json")) as unknown[];
  return (Array.isArray(data) ? data : []).flatMap((a) => {
    const art = a as Record<string, unknown>;
    const url = httpsLink(str(art.url));
    const title = plainText(str(art.title) ?? "", 200);
    if (!url || !title) return [];
    const summary = plainText(str(art.description) ?? "") || null;
    const published = str(art.published_at);
    return [{ title, url, summary, publishedAt: published ? new Date(published) : null, points: num(art.positive_reactions_count), comments: num(art.comments_count), discussionUrl: url }];
  });
}

async function saveEntries(source: Source, entries: Entry[]): Promise<number> {
  const now = Date.now();
  const rows = entries
    .map((e) => {
      const at = e.publishedAt && !Number.isNaN(e.publishedAt.getTime()) ? Math.min(e.publishedAt.getTime(), now) : now;
      return { e, at };
    })
    .filter(({ at }) => at > now - MAX_AGE_DAYS * 86_400_000)
    .map(({ e, at }) => ({
      sourceKey: source.key,
      url: e.url,
      title: e.title,
      summary: e.summary && e.summary.length > 0 ? e.summary.slice(0, 300) : null,
      topic: topicFor(source, e.title),
      publishedAt: new Date(at),
      points: e.points ?? null,
      comments: e.comments ?? null,
      discussionUrl: e.discussionUrl ?? null,
    }));
  // The same link twice in one response would make one insert fail; keep the first.
  const unique = [...new Map(rows.map((r) => [r.url, r])).values()];
  if (unique.length === 0) return 0;
  const saved = await db
    .insert(newsItems)
    .values(unique)
    .onConflictDoUpdate({
      target: newsItems.url,
      // A headline seen again keeps its place; only the live numbers (points, comments) move.
      set: { points: sql`coalesce(excluded.points, ${newsItems.points})`, comments: sql`coalesce(excluded.comments, ${newsItems.comments})` },
    })
    .returning({ id: newsItems.id });
  return saved.length;
}

export type RefreshResult = { checked: number; saved: number; failed: { source: string; error: string }[] };

/**
 * Fetches the sources not checked in the last few hours (all of them with force). Each source is
 * claimed with one UPDATE first, so two visitors opening /news at once never fetch it twice.
 */
export async function refreshNews(options: { force?: boolean } = {}, fetcher: Fetcher = fetch): Promise<RefreshResult> {
  await db
    .insert(newsSources)
    .values(NEWS_SOURCES.map((s) => ({ key: s.key })))
    .onConflictDoNothing();
  const claimed = await db
    .update(newsSources)
    .set({ lastFetchedAt: new Date() })
    .where(
      and(
        eq(newsSources.enabled, true),
        inArray(
          newsSources.key,
          NEWS_SOURCES.map((s) => s.key),
        ),
        options.force ? undefined : or(isNull(newsSources.lastFetchedAt), lt(newsSources.lastFetchedAt, new Date(Date.now() - STALE_HOURS * 3_600_000))),
      ),
    )
    .returning({ key: newsSources.key });
  const result: RefreshResult = { checked: claimed.length, saved: 0, failed: [] };
  await Promise.all(
    claimed.map(async ({ key }) => {
      const source = sourceByKey.get(key)!;
      try {
        result.saved += await saveEntries(source, await entriesFor(source, fetcher));
        await db.update(newsSources).set({ lastOkAt: new Date(), lastError: null }).where(eq(newsSources.key, key));
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        result.failed.push({ source: key, error: message });
        await db.update(newsSources).set({ lastError: message }).where(eq(newsSources.key, key));
      }
    }),
  );
  if (claimed.length > 0) await db.delete(newsItems).where(lt(newsItems.publishedAt, new Date(Date.now() - KEEP_DAYS * 86_400_000)));
  return result;
}

// --- Reading ---------------------------------------------------------------------------------

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  topic: NewsTopic;
  publishedAt: Date;
  source: { name: string; site: string };
  points: number | null;
  comments: number | null;
  discussionUrl: string | null;
  useful: number;
  markedUseful: boolean;
  hidden: boolean;
};

/**
 * The news page: newest first, by topic and words; "top" is this week's headlines that members
 * marked useful most. Organizers also see what they hid, marked as hidden, so they can show it again.
 */
export async function newsFeed(viewer: Member | null, filters: { topic?: string; q?: string; sort?: string } = {}): Promise<NewsItem[]> {
  const organizer = viewer ? await canModerate(viewer) : false;
  const topic = filters.topic && filters.topic in NEWS_TOPICS ? filters.topic : undefined;
  const q = filters.q?.trim().slice(0, 60);
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const top = filters.sort === "top";
  const useful = sql<number>`(select count(*)::int from news_useful u where u.item_id = ${newsItems.id})`;
  const rows = await db
    .select({
      id: newsItems.id,
      title: newsItems.title,
      url: newsItems.url,
      summary: newsItems.summary,
      topic: newsItems.topic,
      publishedAt: newsItems.publishedAt,
      sourceKey: newsItems.sourceKey,
      points: newsItems.points,
      comments: newsItems.comments,
      discussionUrl: newsItems.discussionUrl,
      hiddenAt: newsItems.hiddenAt,
      useful,
      markedUseful: viewer ? sql<boolean>`exists (select 1 from news_useful u where u.item_id = ${newsItems.id} and u.user_id = ${viewer.id})` : sql<boolean>`false`,
    })
    .from(newsItems)
    .innerJoin(newsSources, eq(newsSources.key, newsItems.sourceKey))
    .where(
      and(
        eq(newsSources.enabled, true),
        organizer && !top ? undefined : isNull(newsItems.hiddenAt),
        topic ? eq(newsItems.topic, topic) : undefined,
        like ? or(ilike(newsItems.title, like), ilike(newsItems.summary, like)) : undefined,
        top ? gte(newsItems.publishedAt, new Date(Date.now() - 7 * 86_400_000)) : undefined,
      ),
    )
    .orderBy(...(top ? [desc(useful), desc(sql`coalesce(${newsItems.points}, 0)`), desc(newsItems.publishedAt)] : [desc(newsItems.publishedAt)]))
    .limit(top ? 30 : 80);
  return rows
    .filter((r) => sourceByKey.has(r.sourceKey) && (!top || r.useful > 0 || (r.points ?? 0) > 0))
    .map(({ sourceKey, hiddenAt, topic: t, ...r }) => {
      const s = sourceByKey.get(sourceKey)!;
      return { ...r, topic: t as NewsTopic, source: { name: s.name, site: s.site }, hidden: hiddenAt !== null };
    });
}

/** When the headlines were last fetched (for "Updated … ago"). */
export async function newsUpdatedAt(): Promise<Date | null> {
  const [row] = await db.select({ at: sql<Date | null>`max(${newsSources.lastOkAt})` }).from(newsSources);
  return row?.at ? new Date(row.at) : null;
}

// --- Taking part -----------------------------------------------------------------------------

const validId = (id: string) => z.uuid().safeParse(id).success;

async function visibleItem(itemId: string) {
  if (!validId(itemId)) throw new ServiceError("Headline not found.");
  const [item] = await db.select({ id: newsItems.id, hiddenAt: newsItems.hiddenAt }).from(newsItems).where(eq(newsItems.id, itemId));
  if (!item || item.hiddenAt) throw new ServiceError("Headline not found.");
  return item;
}

/** Marks a headline useful, or takes the mark back. */
export async function toggleNewsUseful(member: Member, itemId: string): Promise<boolean> {
  await visibleItem(itemId);
  const removed = await db
    .delete(newsUseful)
    .where(and(eq(newsUseful.itemId, itemId), eq(newsUseful.userId, member.id)))
    .returning({ id: newsUseful.itemId });
  if (removed.length > 0) return false;
  await db.insert(newsUseful).values({ itemId, userId: member.id }).onConflictDoNothing();
  return true;
}

async function requireOrganizer(member: Member) {
  if (!(await canModerate(member))) throw new ServiceError("Only community organizers can do that.");
}

/** Organizers: hide a headline (or show it again). */
export async function setNewsHidden(member: Member, itemId: string, hidden: boolean) {
  await requireOrganizer(member);
  if (!validId(itemId)) throw new ServiceError("Headline not found.");
  const done = await db
    .update(newsItems)
    .set(hidden ? { hiddenAt: new Date(), hiddenBy: member.id } : { hiddenAt: null, hiddenBy: null })
    .where(eq(newsItems.id, itemId))
    .returning({ id: newsItems.id });
  if (done.length === 0) throw new ServiceError("Headline not found.");
}

export type NewsSourceStatus = { key: string; name: string; site: string; topic: NewsTopic; enabled: boolean; lastFetchedAt: Date | null; lastOkAt: Date | null; lastError: string | null; items: number };

/** Organizers: every source with when it last worked and how many headlines it has. */
export async function newsSourceStatus(member: Member): Promise<NewsSourceStatus[]> {
  await requireOrganizer(member);
  const state = new Map((await db.select().from(newsSources)).map((s) => [s.key, s]));
  const counts = new Map(
    (await db.select({ key: newsItems.sourceKey, n: sql<number>`count(*)::int` }).from(newsItems).groupBy(newsItems.sourceKey)).map((r) => [r.key, r.n]),
  );
  return NEWS_SOURCES.map((s) => {
    const st = state.get(s.key);
    return {
      key: s.key,
      name: s.kind === "dev" ? `${s.name} (${NEWS_TOPICS[s.topic]})` : s.name,
      site: s.site,
      topic: s.topic,
      enabled: st?.enabled ?? true,
      lastFetchedAt: st?.lastFetchedAt ?? null,
      lastOkAt: st?.lastOkAt ?? null,
      lastError: st?.lastError ?? null,
      items: counts.get(s.key) ?? 0,
    };
  });
}

/** Organizers: fetch every switched-on source now instead of waiting for the next refresh. */
export async function refreshNewsNow(member: Member, fetcher: Fetcher = fetch): Promise<RefreshResult> {
  await requireOrganizer(member);
  return refreshNews({ force: true }, fetcher);
}

/** Organizers: switch a source off (its headlines disappear from the page) or on again. */
export async function setNewsSourceEnabled(member: Member, key: string, enabled: boolean) {
  await requireOrganizer(member);
  if (!sourceByKey.has(key)) throw new ServiceError("Unknown source.");
  await db.insert(newsSources).values({ key, enabled }).onConflictDoUpdate({ target: newsSources.key, set: { enabled } });
}
