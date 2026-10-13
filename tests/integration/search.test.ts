import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { users } from "@/lib/db/schema";
import { type Member, acceptConduct, ensureProfile, updateProfile } from "@/modules/community";
import { createArticle, setPublished } from "@/modules/community/articles";
import { searchCommunity } from "@/modules/community/search";
import { createSession } from "@/modules/community/sessions";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 39: one search across the community, showing only what the searcher could see anyway.

// A made-up word that only this run's data contains.
const word = `zq${randomUUID().slice(0, 6)}`;

async function member(name: string, visibility: "PUBLIC" | "MEMBERS", headline = ""): Promise<Member & { handle: string }> {
  const id = randomUUID();
  const m = { id, name, email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  const p = await ensureProfile(m);
  await acceptConduct(m);
  await updateProfile(m, { handle: p.handle, headline, bio: "", city: "Accra", tools: "Supabase", websiteUrl: "", githubUrl: "", linkedinUrl: "", xUrl: "", reviewer: true, wantsMentor: false, visibility });
  return { ...m, handle: p.handle };
}

const hrefs = (groups: Awaited<ReturnType<typeof searchCommunity>>, key: string) => groups.find((g) => g.key === key)?.hits.map((h) => h.href) ?? [];

describe("community search", () => {
  it("finds members, articles and sessions by a word, grouped, with links to each section", async () => {
    const open = await member("Open Builder", "PUBLIC", `Builds ${word} apps`);
    const quiet = await member("Quiet Builder", "MEMBERS", `Also builds ${word} apps`);

    const published = await createArticle(open, { title: `Shipping ${word} to production`, summary: "What I learned along the way.", body: "A long enough body for the article to be valid here.", tags: "" });
    await setPublished(open, published, true);
    const draft = await createArticle(open, { title: `Draft about ${word}`, summary: "Not finished yet, still writing.", body: "A long enough body for the article to be valid here.", tags: "" });

    const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const session = await createSession(open, { title: `Intro to ${word}`, description: "A friendly first look for beginners.", level: "ALL", topics: "Basics", date, time: "18:00", durationMinutes: 60, callUrl: "https://meet.google.com/abc-defg-hij", capacity: "" });

    // A visitor: public profiles only, published articles only.
    const visitor = await searchCommunity(null, word);
    expect(hrefs(visitor, "members")).toEqual([`/members/${open.handle}`]);
    expect(hrefs(visitor, "articles")).toEqual([`/articles/${published}`]);
    expect(hrefs(visitor, "articles")).not.toContain(`/articles/${draft}`);
    expect(hrefs(visitor, "sessions")).toEqual([`/sessions/${session.id}`]);
    expect(visitor.find((g) => g.key === "members")!.seeAll).toBe(`/members?q=${word}`);
    // Groups with nothing are left out.
    expect(visitor.some((g) => g.key === "jobs")).toBe(false);

    // A signed-in member also finds members-only profiles.
    const reader = await member("Reader", "PUBLIC");
    const signedIn = await searchCommunity(reader, word);
    expect(hrefs(signedIn, "members").sort()).toEqual([`/members/${open.handle}`, `/members/${quiet.handle}`].sort());
    expect(signedIn.find((g) => g.key === "members")!.hits.find((h) => h.title === "Open Builder")).toMatchObject({ snippet: `Builds ${word} apps`, meta: "Accra · Supabase" });
  });

  it("needs at least two letters", async () => {
    expect(await searchCommunity(null, " a ")).toEqual([]);
    expect(await searchCommunity(null, "")).toEqual([]);
  });
});
