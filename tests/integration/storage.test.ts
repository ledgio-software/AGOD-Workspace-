import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { showcaseImages, users } from "@/lib/db/schema";
import { storage } from "@/lib/storage";
import { type Member, acceptConduct, ensureProfile } from "@/modules/community";
import { addScreenshot, createPost, openScreenshot, removeScreenshot } from "@/modules/community/showcase";
import { type FakeS3, startFakeS3 } from "../support/fake-s3";
import { db } from "./fixtures";

vi.mock("server-only", () => ({}));

// Phase 26.1: S3-compatible storage (Cloudflare R2) beside the older storage, and screenshots
// stored once however often they are used.

let s3: FakeS3;
let localDir = "";
beforeAll(async () => {
  s3 = await startFakeS3();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await s3.close();
});
beforeEach(() => {
  vi.unstubAllEnvs();
  localDir = mkdtempSync(path.join(tmpdir(), "agod-uploads-"));
  vi.stubEnv("LOCAL_UPLOAD_DIR", localDir);
});

const useR2 = () => {
  vi.stubEnv("S3_ENDPOINT", s3.url);
  vi.stubEnv("S3_BUCKET", "gvcd-files");
  vi.stubEnv("S3_ACCESS_KEY_ID", "test-key-id");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
};
const bytes = (text: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(text)]);
const read = async (body: ReadableStream<Uint8Array> | Uint8Array) => Buffer.from(body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()));

async function member(): Promise<Member> {
  const id = randomUUID();
  const m = { id, name: "Builder", email: `${id}@agod.test` };
  await db.insert(users).values({ ...m, emailVerified: true });
  await ensureProfile(m);
  await acceptConduct(m);
  return m;
}
const post = () => ({
  title: "Storage test",
  pitch: "Checks where screenshots are kept.",
  audience: "",
  builtWith: "",
  aiBuilt: false,
  liveUrl: "",
  repoUrl: "",
  videoUrl: "",
  feedbackAreas: [],
  feedbackWanted: "",
  stuckOn: "",
  needs: [],
  visibility: "PUBLIC" as const,
  safety: true as const,
});

describe("S3-compatible storage", () => {
  it("saves new files to the bucket, signed, and still reads files saved before the switch", async () => {
    const before = storage()!;
    expect(before.name).toBe("local");
    const oldKey = await before.put("projects/p/old.txt", new TextEncoder().encode("saved before R2"), "text/plain");

    useR2();
    const store = storage()!;
    expect(store.name).toBe("s3");
    const key = await store.put("projects/p/new file.png", bytes("new"), "image/png");
    expect(key).toBe("s3:projects/p/new file.png");
    expect(s3.objects.get("/gvcd-files/projects/p/new file.png")?.contentType).toBe("image/png");
    expect((await read((await store.get(key))!.body)).subarray(8).toString()).toBe("new");
    expect((await read((await store.get(oldKey))!.body)).toString()).toBe("saved before R2");
    expect(await store.get("s3:projects/p/missing.png")).toBeNull();
    await store.remove(key);
    expect(s3.objects.has("/gvcd-files/projects/p/new file.png")).toBe(false);

    // A wrong key is refused by the bucket.
    vi.stubEnv("S3_ACCESS_KEY_ID", "someone-else");
    await expect(storage()!.put("x.png", bytes("x"), "image/png")).rejects.toThrow(/refused the upload \(403\)/);
  });
});

describe("screenshots stored once", () => {
  it("fingerprints each picture, shares identical ones between projects, and refuses a repeat on one project", async () => {
    useR2();
    const a = await member();
    const b = await member();
    const pa = await createPost(a, post());
    const pb = await createPost(b, post());
    const picture = bytes(`same picture ${randomUUID()}`);
    const sha = createHash("sha256").update(picture).digest("hex");
    const puts = () => s3.requests.filter((r) => r.startsWith("PUT")).length;
    const start = puts();

    const first = await addScreenshot(a, pa.id, { name: "home.png", bytes: picture });
    expect(first.sha256).toBe(sha);
    expect(first.storageKey).toBe(`s3:community/showcase/${sha.slice(0, 2)}/${sha}.png`);
    await expect(addScreenshot(a, pa.id, { name: "again.png", bytes: picture })).rejects.toThrow(/already on the project/);
    const second = await addScreenshot(b, pb.id, { name: "copy.png", bytes: picture });
    expect(second.storageKey).toBe(first.storageKey);
    expect(puts() - start).toBe(1);

    // Removing it from one project leaves the other's intact (stored files are never deleted).
    await removeScreenshot(a, first.id);
    const opened = await openScreenshot(pb.id, second.id, null);
    expect(Buffer.from(await read(opened!.body)).equals(Buffer.from(picture))).toBe(true);
    // ...and it can be added back to the first project.
    const back = await addScreenshot(a, pa.id, { name: "home.png", bytes: picture });
    expect(back.storageKey).toBe(first.storageKey);
    expect((await db.select().from(showcaseImages).where(eq(showcaseImages.sha256, sha))).length).toBe(3);
  });
});
