import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "./url";

describe("normalizeDatabaseUrl", () => {
  it("makes sslmode=require explicit as verify-full", () => {
    const url = normalizeDatabaseUrl(
      "postgresql://u:p@ep-x-pooler.neon.tech/neondb?sslmode=require&channel_binding=require",
    );
    expect(new URL(url).searchParams.get("sslmode")).toBe("verify-full");
    expect(new URL(url).searchParams.get("channel_binding")).toBe("require");
  });

  it("leaves local URLs without sslmode untouched", () => {
    const url = "postgresql://postgres@localhost:5432/agod";
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });
});
