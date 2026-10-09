import { describe, expect, it } from "vitest";
import { clip, indexingAllowed, pageMetadata, siteUrl } from "./site";

describe("indexingAllowed", () => {
  it("indexes only Vercel production", () => {
    expect(indexingAllowed({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(true);
    expect(indexingAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(indexingAllowed({ VERCEL_ENV: "development" })).toBe(false);
  });
  it("follows NODE_ENV outside Vercel", () => {
    expect(indexingAllowed({ NODE_ENV: "production" })).toBe(true);
    expect(indexingAllowed({ NODE_ENV: "development" })).toBe(false);
  });
  it("can be switched off on production", () => {
    expect(indexingAllowed({ VERCEL_ENV: "production", SEARCH_INDEXING: "off" })).toBe(false);
    expect(indexingAllowed({ NODE_ENV: "production", SEARCH_INDEXING: " OFF " })).toBe(false);
  });
});

describe("siteUrl", () => {
  it("drops a trailing slash and is null when unknown", () => {
    expect(siteUrl({ BETTER_AUTH_URL: "https://gvcd.example/" })).toBe("https://gvcd.example");
    expect(siteUrl({})).toBeNull();
  });
  it("reads an address without https, and never throws on a bad one", () => {
    expect(siteUrl({ BETTER_AUTH_URL: "gvcd.example" })).toBe("https://gvcd.example");
    expect(siteUrl({ BETTER_AUTH_URL: " https://gvcd.example/app " })).toBe("https://gvcd.example");
    expect(siteUrl({ BETTER_AUTH_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(siteUrl({ BETTER_AUTH_URL: "https://" })).toBeNull();
    expect(siteUrl({ BETTER_AUTH_URL: "ftp://gvcd.example" })).toBeNull();
  });
});

describe("clip and pageMetadata", () => {
  it("makes one plain line, cut at a word", () => {
    expect(clip("## Hello   **world**\n\nnext", 100)).toBe("Hello world next");
    const long = clip("word ".repeat(100), 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("word…")).toBe(true);
  });
  it("gives every page a title, description and the preview picture", () => {
    const m = pageMetadata("Jobs", "Paid work", { type: "article", publishedTime: new Date("2026-10-08T00:00:00Z") });
    expect(m).toMatchObject({ title: "Jobs", description: "Paid work", openGraph: { title: "Jobs", type: "article", publishedTime: "2026-10-08T00:00:00.000Z", images: [{ url: "/opengraph-image" }] }, twitter: { card: "summary_large_image" } });
    expect(pageMetadata("x").description).toBeUndefined();
  });
});
