import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Google refresh tokens at rest: AES-256-GCM with a key derived (HKDF) from BETTER_AUTH_SECRET, so
// a database dump alone does not reveal them. Format: v1.<iv>.<tag>.<ciphertext> (base64url).

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "agod-google-tokens", "refresh-token-v1", 32));
}

export function sealSecret(plain: string, secret = process.env.BETTER_AUTH_SECRET ?? ""): string {
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET is required to store Google tokens");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openSecret(sealed: string, secret = process.env.BETTER_AUTH_SECRET ?? ""): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised token format");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
