import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for an S3-compatible store (Cloudflare R2) for tests: keeps objects in memory and
// refuses requests without a SigV4 signature for the expected key id.

export type FakeS3 = { url: string; server: Server; objects: Map<string, { bytes: Buffer; contentType: string }>; requests: string[]; close(): Promise<void> };

export async function startFakeS3(accessKeyId = "test-key-id"): Promise<FakeS3> {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    requests.push(`${req.method} ${path}`);
    if (!(req.headers.authorization ?? "").startsWith(`AWS4-HMAC-SHA256 Credential=${accessKeyId}/`) || !req.headers["x-amz-date"]) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      objects.set(path, { bytes: Buffer.concat(chunks), contentType: String(req.headers["content-type"] ?? "") });
      res.writeHead(200).end();
      return;
    }
    const object = objects.get(path);
    if (req.method === "GET") {
      if (!object) return void res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": object.contentType }).end(object.bytes);
      return;
    }
    if (req.method === "DELETE") {
      objects.delete(path);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, objects, requests, close: () => new Promise((r) => server.close(() => r())) };
}
