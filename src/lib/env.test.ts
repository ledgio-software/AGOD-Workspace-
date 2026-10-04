import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/agod",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a valid configuration and defaults the timezone", () => {
    expect(parseEnv(valid).APP_TIMEZONE).toBe("Africa/Accra");
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
});
