import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyWebhookSignature } from "./signature";

vi.mock("server-only", () => ({}));

describe("webhook signature", () => {
  const body = '{"action":"opened"}';
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts the right signature and rejects anything else", () => {
    expect(verifyWebhookSignature("s3cret", body, sign("s3cret"))).toBe(true);
    expect(verifyWebhookSignature("s3cret", body, sign("other"))).toBe(false);
    expect(verifyWebhookSignature("s3cret", `${body} `, sign("s3cret"))).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, null)).toBe(false);
    expect(verifyWebhookSignature("", body, sign(""))).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, "sha1=abc")).toBe(false);
  });
});

describe("GitHub App configuration and JWT", async () => {
  const { createAppJwt, githubConfig } = await import("./app");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("needs the app ID, private key and webhook secret", () => {
    expect(githubConfig({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem })).toBeNull();
    const config = githubConfig({ GITHUB_APP_ID: " 1 ", GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, "\\n"), GITHUB_WEBHOOK_SECRET: "x" });
    expect(config).toMatchObject({ appId: "1", installationId: null });
    expect(config?.privateKey).toBe(pem.trim());
  });

  it("signs an RS256 JWT for the app that verifies with its public key", () => {
    const jwt = createAppJwt("12345", pem, new Date("2026-10-05T00:00:00Z"));
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toEqual({ iss: "12345", iat: 1791158340, exp: 1791158340 + 540 });
    const ok = createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });
});
