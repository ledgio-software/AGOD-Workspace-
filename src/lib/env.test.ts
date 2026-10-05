import { describe, expect, it } from "vitest";
import { parseEnv, resolveBaseUrl } from "./env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/agod",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a valid configuration and defaults the timezone", () => {
    const env = parseEnv(valid);
    expect(env.APP_TIMEZONE).toBe("Africa/Accra");
    expect(env.baseUrl).toBe("http://localhost:3000");
  });

  it("rejects a short auth secret", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects a missing database URL without echoing other values", () => {
    const run = () => parseEnv({ ...valid, DATABASE_URL: undefined });
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).not.toThrow(/x{32}/);
  });

  it("requires a base URL outside Vercel", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_URL: undefined })).toThrow(/BETTER_AUTH_URL/);
  });
});

describe("resolveBaseUrl", () => {
  it("prefers an explicit BETTER_AUTH_URL", () => {
    expect(resolveBaseUrl({ BETTER_AUTH_URL: "https://x.test", VERCEL_BRANCH_URL: "b.vercel.app" })).toBe(
      "https://x.test",
    );
  });

  it("uses the production domain in Vercel production", () => {
    expect(
      resolveBaseUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "agod-workspace.vercel.app",
        VERCEL_BRANCH_URL: "agod-workspace-git-main.vercel.app",
      }),
    ).toBe("https://agod-workspace.vercel.app");
  });

  it("uses the branch URL in Vercel previews", () => {
    expect(
      resolveBaseUrl({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "agod-workspace-git-integration-x.vercel.app",
        VERCEL_URL: "agod-workspace-abc123-x.vercel.app",
      }),
    ).toBe("https://agod-workspace-git-integration-x.vercel.app");
  });
});
