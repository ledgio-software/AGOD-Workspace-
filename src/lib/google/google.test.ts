import { describe, expect, it } from "vitest";
import { googleConfig } from "./config";
import { authorizationUrl, multipartBody, newAuthRequest } from "./client";
import { openSecret, sealSecret } from "./secret";

const SECRET = "x".repeat(40);

describe("Google settings", () => {
  it("is off without a client id and secret; the test server only applies outside Vercel", () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: "id" })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" })?.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(googleConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", GOOGLE_API_BASE_FOR_TESTS: "http://localhost:9" })?.tokenUrl).toBe("http://localhost:9/token");
    expect(googleConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", GOOGLE_API_BASE_FOR_TESTS: "http://localhost:9", VERCEL: "1" })?.tokenUrl).toBe("https://oauth2.googleapis.com/token");
  });
});

describe("token encryption", () => {
  it("round-trips, differs every time and refuses tampering or the wrong key", () => {
    const a = sealSecret("1//refresh-token", SECRET);
    const b = sealSecret("1//refresh-token", SECRET);
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh");
    expect(openSecret(a, SECRET)).toBe("1//refresh-token");
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openSecret(parts.join("."), SECRET)).toThrow();
    expect(() => openSecret(a, "y".repeat(40))).toThrow();
    expect(() => sealSecret("t", "short")).toThrow(/BETTER_AUTH_SECRET/);
  });
});

describe("OAuth and uploads", () => {
  it("asks for offline access with PKCE", () => {
    const req = newAuthRequest();
    const config = googleConfig({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "s" })!;
    const url = new URL(authorizationUrl(config, { redirectUri: "https://app.example/api/google/callback", scopes: ["openid", "email"], state: req.state, challenge: req.challenge }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(req.challenge);
    expect(url.searchParams.get("state")).toBe(req.state);
    expect(req.challenge).not.toBe(req.verifier);
  });

  it("builds a multipart upload with metadata then the file bytes", () => {
    const { body, contentType } = multipartBody({ name: "a.pdf", parents: ["F1"] }, new Uint8Array([1, 2, 3]), "application/pdf");
    const boundary = contentType.split("boundary=")[1];
    const text = body.toString("latin1");
    expect(text.startsWith(`--${boundary}\r\nContent-Type: application/json`)).toBe(true);
    expect(text).toContain('"parents":["F1"]');
    expect(text).toContain("Content-Type: application/pdf\r\n\r\n\u0001\u0002\u0003\r\n");
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });
});
