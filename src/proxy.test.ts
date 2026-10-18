import { describe, expect, it } from "vitest";
import { PUBLIC } from "./proxy";

// Guards the list of pages visitors can open without signing in (a merge once dropped half of it).
describe("public pages", () => {
  it("lets visitors open the community, news, search and what search engines read", () => {
    for (const path of ["/", "/members", "/members/ama", "/showcase/1", "/sessions", "/library", "/mentors", "/jobs/1", "/teams", "/articles/1", "/news", "/search", "/code-of-conduct", "/robots.txt", "/sitemap.xml", "/opengraph-image"]) {
      expect(PUBLIC.test(path), path).toBe(true);
    }
  });

  it("keeps signed-in areas private", () => {
    for (const path of ["/community", "/console", "/dashboard", "/projects", "/newsletter", "/search-admin"]) {
      expect(PUBLIC.test(path), path).toBe(false);
    }
  });
});
