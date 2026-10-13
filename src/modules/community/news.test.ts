import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { NEWS_SOURCES, topicFor } = await import("./news");

describe("news topics", () => {
  const tech = { topic: "TECH" as const };
  it("files AI headlines from general sources under AI", () => {
    expect(topicFor(tech, "OpenAI ships a new model")).toBe("AI");
    expect(topicFor(tech, "Machine learning on a budget")).toBe("AI");
    expect(topicFor({ topic: "PROGRAMMING" }, "Building agents with LLMs")).toBe("AI");
    expect(topicFor(tech, "GPT-5 arrives")).toBe("AI");
  });
  it("leaves other headlines and specific sources alone", () => {
    expect(topicFor(tech, "He said the phone ships in May")).toBe("TECH");
    expect(topicFor(tech, "Email aid for startups")).toBe("TECH");
    expect(topicFor({ topic: "AFRICA" }, "Nigerian startup builds an AI tutor")).toBe("AFRICA");
    expect(topicFor({ topic: "RELEASES" }, "Next.js adds AI tooling")).toBe("RELEASES");
  });
  it("lists only https feeds with unique keys", () => {
    expect(new Set(NEWS_SOURCES.map((s) => s.key)).size).toBe(NEWS_SOURCES.length);
    for (const s of NEWS_SOURCES) {
      expect(s.site.startsWith("https://")).toBe(true);
      if (s.kind === "feed") expect(s.url.startsWith("https://")).toBe(true);
    }
  });
});
