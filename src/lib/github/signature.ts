import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies GitHub's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body) in constant time. */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
