import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
import { AwsClient } from "aws4fetch";

// Private file storage for attachments and community screenshots. Files are only ever served
// through the app. Where new files go:
//  - S3-compatible storage (Phase 26.1: Cloudflare R2, Backblaze B2, ...) when S3_* is set: the
//    cheapest at scale (R2 has a free allowance and no charge for downloads);
//  - else a Vercel Blob store, connected either the newer way (BLOB_STORE_ID: the app signs in
//    with Vercel's short-lived OIDC token, nothing secret to keep) or the older way
//    (BLOB_READ_WRITE_TOKEN);
//  - else, off Vercel (local development and tests), a folder on disk.
// Files are read from wherever they were saved: S3 keys carry an "s3:" prefix, so switching to R2
// keeps older Blob files readable as long as the Blob store stays connected.

export type StoredFile = { body: ReadableStream<Uint8Array> | Uint8Array };

export type Storage = {
  name: "s3" | "vercel-blob" | "local";
  /** Saves the file and returns the key to keep (it may differ from the one asked for). */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  get(key: string): Promise<StoredFile | null>;
  remove(key: string): Promise<void>;
};

type Env = Record<string, string | undefined>;

/** Without a token the Blob library signs in with Vercel's OIDC token and BLOB_STORE_ID. */
const blob = (token?: string): Storage => ({
  name: "vercel-blob",
  async put(key, bytes, contentType) {
    const result = await put(key, Buffer.from(bytes), { access: "private", contentType, addRandomSuffix: true, token });
    return result.pathname;
  },
  async get(key) {
    const result = await get(key, { access: "private", token });
    if (!result?.stream) return null;
    return { body: result.stream };
  },
  async remove(key) {
    await del(key, { token });
  },
});

const local = (root: string): Storage => {
  const resolve = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  return {
    name: "local",
    async put(key, bytes) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes);
      return key;
    },
    async get(key) {
      try {
        return { body: new Uint8Array(await readFile(resolve(key))) };
      } catch {
        return null;
      }
    },
    async remove() {
      // Local files are kept, like removed attachments' rows.
    },
  };
};

export type S3Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string };

/** S3-compatible storage settings, or null when not (fully) configured. */
export function s3Config(source: Env = process.env): S3Config | null {
  const endpoint = source.S3_ENDPOINT?.trim().replace(/\/+$/, "");
  const bucket = source.S3_BUCKET?.trim();
  const accessKeyId = source.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = source.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  // Plain http only for a local test server.
  if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(endpoint)) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: source.S3_REGION?.trim() || "auto" };
}

const S3_PREFIX = "s3:";
const TIMEOUT = 30_000;

function s3(config: S3Config): Storage {
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: config.region });
  const url = (key: string) => `${config.endpoint}/${encodeURIComponent(config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const objectKey = (stored: string) => (stored.startsWith(S3_PREFIX) ? stored.slice(S3_PREFIX.length) : stored);
  return {
    name: "s3",
    async put(key, bytes, contentType) {
      const response = await client.fetch(url(key), {
        method: "PUT",
        body: Buffer.from(bytes),
        headers: { "Content-Type": contentType, "Content-Length": String(bytes.length) },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!response.ok) throw new Error(`File storage refused the upload (${response.status})`);
      return `${S3_PREFIX}${key}`;
    },
    async get(stored) {
      const response = await client.fetch(url(objectKey(stored)), { signal: AbortSignal.timeout(TIMEOUT) });
      if (response.status === 404) return null;
      if (!response.ok || !response.body) throw new Error(`File storage refused the download (${response.status})`);
      return { body: response.body };
    },
    async remove(stored) {
      const response = await client.fetch(url(objectKey(stored)), { method: "DELETE", signal: AbortSignal.timeout(TIMEOUT) });
      if (!response.ok && response.status !== 404) throw new Error(`File storage refused the removal (${response.status})`);
    },
  };
}

/** Where files saved without the "s3:" prefix live (Blob on Vercel, a folder elsewhere). */
function legacy(source: Env): Storage | null {
  // The newer connection wins, so revoking the old token later doesn't switch uploads off.
  if (source.BLOB_STORE_ID) return blob();
  if (source.BLOB_READ_WRITE_TOKEN) return blob(source.BLOB_READ_WRITE_TOKEN);
  // Never fall back to the (ephemeral) local disk on Vercel.
  if (source.VERCEL) return null;
  return local(source.LOCAL_UPLOAD_DIR || path.join(process.cwd(), ".data", "uploads"));
}

/** The configured storage, or null when uploads are not available in this environment. */
export function storage(source: Env = process.env): Storage | null {
  const config = s3Config(source);
  const older = legacy(source);
  if (!config) return older;
  const primary = s3(config);
  const route = (key: string) => (key.startsWith(S3_PREFIX) ? primary : older);
  return {
    name: "s3",
    put: (key, bytes, contentType) => primary.put(key, bytes, contentType),
    get: async (key) => (await route(key)?.get(key)) ?? null,
    remove: async (key) => {
      await route(key)?.remove(key);
    },
  };
}
