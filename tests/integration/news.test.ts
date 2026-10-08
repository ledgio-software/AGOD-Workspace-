import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsItems, newsSources, users } from "@/lib/db/schema";
import { type Member, ensureProfile } from "@/modules/community";
import { type Fetcher, NEWS_SOURCES, newsFeed, newsSourceStatus, refreshNews, setNewsHidden, setNewsSourceEnabled, toggleNewsUseful } from "@/modules/community/news";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 38: tech news. The fetcher is a fake: no test reaches the internet.

async function member(name: string): Promise<Member> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  await ensureProfile(m);
  return m;
}

const run = randomUUID().slice(0, 8);
// Hacker News ids are numbers; fresh ones each run, so a reused test database has no clashes.
const hnId = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
const today = new Date().toUTCString();
const old = new Date(Date.now() - 30 * 86_400_000).toUTCString();

function rss(key: string) {
  return `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>${key} headline ${run}</title><link>https://news.example/${key}/${run}/1</link><description>&lt;p&gt;About ${key}&lt;/p&gt;</description><pubDate>${today}</pubDate></item>
    <item><title>OpenAI ships a model ${key} ${run}</title><link>https://news.example/${key}/${run}/ai</link><pubDate>${today}</pubDate></item>
    <item><title>Too old ${key} ${run}</title><link>https://news.example/${key}/${run}/old</link><pubDate>${old}</pubDate></item>
    <item><title>Not https ${key} ${run}</title><link>http://news.example/${key}/${run}/plain</link><pubDate>${today}</pubDate></item>
    ${key === "vercel" ? `<item><title>Huge</title><description>${"x".repeat(3_000_000)}</description></item>` : ""}
  </channel></rss>`;
}

function fakeFetcher(options: { failing?: string[]; points?: number } = {}): { fetcher: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const source = NEWS_SOURCES.find((s) => (s.kind === "feed" ? s.url === url : s.kind === "hn" ? url.includes("hn.algolia.com") : url.includes(s.query)));
    if (!source) return new Response("not found", { status: 404 });
    if (options.failing?.includes(source.key)) return new Response("blocked", { status: 403 });
    if (source.kind === "hn") {
      return Response.json({
        hits: [
          { objectID: String(hnId), title: `Show HN: a tool ${run}`, url: `https://tool.example/${run}`, points: options.points ?? 120, num_comments: 40, created_at: new Date().toISOString() },
          { objectID: String(hnId + 1), title: `Ask HN: how do you learn ${run}?`, url: null, points: 80, num_comments: 90, created_at: new Date().toISOString() },
        ],
      });
    }
    if (source.kind === "dev") {
      return Response.json([{ title: `${source.key} post ${run}`, url: `https://dev.to/someone/${source.key}-${run}`, description: "A short description", published_at: new Date().toISOString(), positive_reactions_count: 12, comments_count: 3 }]);
    }
    return new Response(rss(source.key), { headers: { "content-type": "application/rss+xml" } });
  };
  return { fetcher, calls };
}

const mine = <T extends { title: string }>(items: T[]) => items.filter((i) => i.title.includes(run));

describe("tech news", () => {
  beforeEach(async () => {
    await db.update(newsSources).set({ enabled: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fetches every source, keeps fresh https headlines and sorts AI headlines under AI", async () => {
    const { fetcher, calls } = fakeFetcher({ failing: ["the-verge"] });
    const result = await refreshNews({ force: true }, fetcher);
    expect(result.checked).toBe(NEWS_SOURCES.length);
    expect(calls).toHaveLength(NEWS_SOURCES.length);
    expect(result.failed).toEqual([{ source: "the-verge", error: "HTTP 403" }]);

    const feed = mine(await newsFeed(null));
    const titles = feed.map((i) => i.title);
    expect(titles).toContain(`techcabal headline ${run}`);
    // A feed of several megabytes is read up to the limit; the entries before the cut are kept.
    expect(titles).toContain(`vercel headline ${run}`);
    expect(titles.some((t) => t.startsWith("Too old"))).toBe(false);
    expect(titles.some((t) => t.startsWith("Not https"))).toBe(false);
    expect(titles.some((t) => t.startsWith("the-verge"))).toBe(false);

    const cabal = feed.find((i) => i.title === `techcabal headline ${run}`)!;
    expect(cabal).toMatchObject({ topic: "AFRICA", summary: "About techcabal", source: { name: "TechCabal" } });
    // A TECH source's AI headline is filed under AI; an Africa source keeps its topic.
    expect(feed.find((i) => i.title === `OpenAI ships a model techcrunch ${run}`)!.topic).toBe("AI");
    expect(feed.find((i) => i.title === `OpenAI ships a model techcabal ${run}`)!.topic).toBe("AFRICA");

    const hn = feed.find((i) => i.title === `Show HN: a tool ${run}`)!;
    expect(hn).toMatchObject({ url: `https://tool.example/${run}`, points: 120, comments: 40, discussionUrl: `https://news.ycombinator.com/item?id=${hnId}` });
    // Ask HN has no link of its own, so the headline links to the discussion.
    expect(feed.find((i) => i.title === `Ask HN: how do you learn ${run}?`)!.url).toBe(`https://news.ycombinator.com/item?id=${hnId + 1}`);

    expect(mine(await newsFeed(null, { topic: "AFRICA" })).every((i) => i.topic === "AFRICA")).toBe(true);
    expect(mine(await newsFeed(null, { q: `techcabal headline ${run}` }))).toHaveLength(1);
  });

  it("doesn't fetch again within a few hours unless forced, and updates live numbers", async () => {
    await refreshNews({ force: true }, fakeFetcher().fetcher);
    const again = fakeFetcher({ points: 300 });
    expect((await refreshNews({}, again.fetcher)).checked).toBe(0);
    expect(again.calls).toHaveLength(0);

    await refreshNews({ force: true }, again.fetcher);
    const [row] = await db.select().from(newsItems).where(eq(newsItems.url, `https://tool.example/${run}`));
    expect(row.points).toBe(300);
    expect((await db.select().from(newsItems).where(eq(newsItems.url, `https://tool.example/${run}`))).length).toBe(1);
  });

  it("members mark headlines useful, and the top list ranks by it", async () => {
    await refreshNews({ force: true }, fakeFetcher().fetcher);
    const a = await member("Ama");
    const b = await member("Kofi");
    const item = mine(await newsFeed(a)).find((i) => i.title === `github-blog headline ${run}`)!;
    expect(item.useful).toBe(0);
    expect(await toggleNewsUseful(a, item.id)).toBe(true);
    expect(await toggleNewsUseful(b, item.id)).toBe(true);
    const seen = mine(await newsFeed(a)).find((i) => i.id === item.id)!;
    expect(seen).toMatchObject({ useful: 2, markedUseful: true });

    const top = await newsFeed(null, { sort: "top" });
    expect(top[0].useful).toBeGreaterThanOrEqual(2);
    expect(top.some((i) => i.id === item.id)).toBe(true);
    // Plain feed headlines nobody marked aren't in the top list.
    expect(top.some((i) => i.title === `techcabal headline ${run}`)).toBe(false);

    expect(await toggleNewsUseful(a, item.id)).toBe(false);
    await expect(toggleNewsUseful(a, "not-an-id")).rejects.toThrow("Headline not found.");
  });

  it("organizers hide headlines and switch sources off; others can't", async () => {
    await refreshNews({ force: true }, fakeFetcher().fetcher);
    const org = await member("Organizer");
    const reader = await member("Reader");
    vi.stubEnv("COMMUNITY_ORGANIZER_EMAILS", org.email);
    const item = mine(await newsFeed(reader)).find((i) => i.title === `techcrunch headline ${run}`)!;

    await expect(setNewsHidden(reader, item.id, true)).rejects.toThrow("Only community organizers");
    await expect(setNewsSourceEnabled(reader, "techcrunch", false)).rejects.toThrow("Only community organizers");
    await expect(newsSourceStatus(reader)).rejects.toThrow("Only community organizers");

    await setNewsHidden(org, item.id, true);
    expect(mine(await newsFeed(reader)).some((i) => i.id === item.id)).toBe(false);
    expect(mine(await newsFeed(org)).find((i) => i.id === item.id)!.hidden).toBe(true);
    await expect(toggleNewsUseful(reader, item.id)).rejects.toThrow("Headline not found.");
    await setNewsHidden(org, item.id, false);
    expect(mine(await newsFeed(reader)).some((i) => i.id === item.id)).toBe(true);

    await setNewsSourceEnabled(org, "techcabal", false);
    expect(mine(await newsFeed(reader)).some((i) => i.title.startsWith("techcabal"))).toBe(false);
    const status = await newsSourceStatus(org);
    expect(status.find((s) => s.key === "techcabal")).toMatchObject({ enabled: false });
    expect(status.find((s) => s.key === "techcrunch")!.items).toBeGreaterThan(0);
    // A switched-off source isn't fetched.
    const off = fakeFetcher();
    await refreshNews({ force: true }, off.fetcher);
    expect(off.calls.some((u) => u.includes("techcabal"))).toBe(false);
    await expect(setNewsSourceEnabled(org, "nope", false)).rejects.toThrow("Unknown source.");
  });
});
