// One-off move off Vercel (docs/RENDER.md): copies every file in a Vercel Blob store to the
// S3-compatible bucket (Cloudflare R2) under the same name. The app then reads older files from
// the bucket once BLOB_* is removed (src/lib/storage.ts), so no database change is needed.
// Safe to run again: files already in the bucket with the same size are skipped.
//
//   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... \
//   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com S3_BUCKET=... \
//   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
//   npm run storage:copy-blob
import { get, list } from "@vercel/blob";
import { AwsClient } from "aws4fetch";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. See the comment at the top of scripts/copy-blob-to-s3.ts.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const token = required("BLOB_READ_WRITE_TOKEN");
  const endpoint = required("S3_ENDPOINT").replace(/\/+$/, "");
  const bucket = required("S3_BUCKET");
  const client = new AwsClient({
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    service: "s3",
    region: process.env.S3_REGION?.trim() || "auto",
  });
  const url = (key: string) => `${endpoint}/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;

  let cursor: string | undefined;
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  do {
    const page = await list({ token, cursor, limit: 1000 });
    for (const item of page.blobs) {
      const key = item.pathname;
      try {
        const head = await client.fetch(url(key), { method: "HEAD" });
        if (head.ok && Number(head.headers.get("content-length")) === item.size) {
          skipped++;
          continue;
        }
        const file = await get(key, { access: "private", token });
        if (!file || file.statusCode !== 200) throw new Error("not found in Blob");
        const bytes = Buffer.from(await new Response(file.stream).arrayBuffer());
        const put = await client.fetch(url(key), {
          method: "PUT",
          body: bytes,
          headers: { "Content-Type": file.blob.contentType || "application/octet-stream", "Content-Length": String(bytes.length) },
        });
        if (!put.ok) throw new Error(`bucket refused the upload (${put.status})`);
        copied++;
        console.log(`copied ${key} (${bytes.length} bytes)`);
      } catch (error) {
        failed++;
        console.error(`FAILED ${key}: ${error instanceof Error ? error.message : error}`);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  console.log(`\nDone: ${copied} copied, ${skipped} already there, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
