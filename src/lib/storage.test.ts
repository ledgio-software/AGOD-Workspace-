import { describe, expect, it, vi } from "vitest";
import { s3Config, storage } from "./storage";

vi.mock("server-only", () => ({}));

const r2 = {
  S3_ENDPOINT: "https://abc123.r2.cloudflarestorage.com/",
  S3_BUCKET: "gvcd-files",
  S3_ACCESS_KEY_ID: "key-id",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("choosing file storage (Phase 26.1)", () => {
  it("uses S3-compatible storage (Cloudflare R2) only when fully configured over https", () => {
    expect(s3Config(r2)).toEqual({ endpoint: "https://abc123.r2.cloudflarestorage.com", bucket: "gvcd-files", accessKeyId: "key-id", secretAccessKey: "secret", region: "auto" });
    expect(s3Config({ ...r2, S3_BUCKET: "" })).toBeNull();
    expect(s3Config({ ...r2, S3_ENDPOINT: "http://files.example.com" })).toBeNull();
    expect(s3Config({ ...r2, S3_ENDPOINT: "http://127.0.0.1:9000" })?.endpoint).toBe("http://127.0.0.1:9000");
    expect(s3Config({ ...r2, S3_REGION: "eu-central-1" })?.region).toBe("eu-central-1");
  });

  it("prefers S3, then Vercel Blob, then a local folder (never on Vercel)", () => {
    expect(storage({ ...r2, BLOB_READ_WRITE_TOKEN: "t" })?.name).toBe("s3");
    expect(storage({ BLOB_READ_WRITE_TOKEN: "t" })?.name).toBe("vercel-blob");
    expect(storage({ LOCAL_UPLOAD_DIR: "/tmp/x" })?.name).toBe("local");
    expect(storage({ VERCEL: "1" })).toBeNull();
    expect(storage({ ...r2, VERCEL: "1" })?.name).toBe("s3");
  });
});
