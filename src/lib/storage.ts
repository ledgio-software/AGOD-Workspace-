import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";

// Private file storage for attachments. On Vercel: a Vercel Blob store with private access
// (BLOB_READ_WRITE_TOKEN, added when the store is connected to the project). Elsewhere (local
// development and tests): a folder on disk. Files are only ever served through the app.

export type StoredFile = { body: ReadableStream<Uint8Array> | Uint8Array };

export type Storage = {
  name: "vercel-blob" | "local";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  get(key: string): Promise<StoredFile | null>;
  remove(key: string): Promise<void>;
};

const blob = (token: string): Storage => ({
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

/** The configured storage, or null when attachments are not available in this environment. */
export function storage(source: Record<string, string | undefined> = process.env): Storage | null {
  if (source.BLOB_READ_WRITE_TOKEN) return blob(source.BLOB_READ_WRITE_TOKEN);
  // Never fall back to the (ephemeral) local disk on Vercel.
  if (source.VERCEL) return null;
  return local(source.LOCAL_UPLOAD_DIR || path.join(process.cwd(), ".data", "uploads"));
}
