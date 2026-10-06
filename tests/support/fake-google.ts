import { createHash, randomBytes } from "node:crypto";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for the parts of Google the app calls (OAuth, userinfo, Drive files and sharing),
// for integration and end-to-end tests. Point the app at it with GOOGLE_API_BASE_FOR_TESTS.
// It checks what the real API would refuse: PKCE, client secret, access tokens, missing parents,
// and sharing with an address that has no Google account (here: anything @nogoogle.test).

export type FakeFile = { id: string; name: string; mimeType: string; parents: string[]; bytes: Buffer; description?: string };
export type FakePermission = { id: string; type: string; role: string; emailAddress: string };

export type FakeGoogle = {
  url: string;
  server: Server;
  files: Map<string, FakeFile>;
  permissions: Map<string, FakePermission[]>;
  /** The account the consent screen "signs in" as. */
  account: { email: string; grantDrive: boolean };
  /** Refresh tokens issued, and whether they still work. */
  refreshTokens: Map<string, { email: string; revoked: boolean }>;
  requests: string[];
  /** The account removed the app's access (Google account → Security): every token stops working. */
  revokeAll(): void;
  close(): Promise<void>;
};

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
export const fakeGoogleEnv = (url: string) => ({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_API_BASE_FOR_TESTS: url });

const id = () => randomBytes(9).toString("base64url");

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, data?: unknown, headers: Record<string, string> = {}) {
  if (data instanceof Buffer) {
    res.writeHead(status, { "Content-Type": "application/octet-stream", ...headers });
    res.end(data);
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

const driveError = (res: ServerResponse, status: number, message: string, reason: string) =>
  send(res, status, { error: { code: status, message, errors: [{ reason, message }] } });

/** Splits a multipart/related upload into its metadata and content. */
function parseMultipart(contentType: string, raw: Buffer) {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (!boundary) throw new Error("no boundary");
  const parts: Buffer[] = [];
  const delimiter = Buffer.from(`--${boundary}`);
  let start = raw.indexOf(delimiter);
  while (start !== -1) {
    const next = raw.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    parts.push(raw.subarray(start + delimiter.length + 2, next - 2));
    start = next;
  }
  const split = (part: Buffer) => {
    const end = part.indexOf("\r\n\r\n");
    return { headers: part.subarray(0, end).toString(), content: part.subarray(end + 4) };
  };
  const [meta, media] = parts.map(split);
  return { metadata: JSON.parse(meta.content.toString()) as { name: string; parents?: string[]; description?: string }, contentType: /Content-Type: (.+)/i.exec(media.headers)?.[1].trim() ?? "", bytes: Buffer.from(media.content) };
}

export async function startFakeGoogle(port = 0): Promise<FakeGoogle> {
  const files = new Map<string, FakeFile>();
  const permissions = new Map<string, FakePermission[]>();
  const codes = new Map<string, { challenge: string; scope: string; redirectUri: string }>();
  const accessTokens = new Map<string, string>(); // token -> email
  const refreshTokens = new Map<string, { email: string; revoked: boolean }>();
  const requests: string[] = [];
  const account = { email: "agod.team@gmail.com", grantDrive: true };

  const userOf = (req: IncomingMessage) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    return token ? accessTokens.get(token) : undefined;
  };
  const issueAccess = (email: string) => {
    const token = `at-${id()}`;
    accessTokens.set(token, email);
    return token;
  };
  const view = (f: FakeFile) => ({ id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: `https://drive.google.com/drive/folders/${f.id}`, size: String(f.bytes.length) });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://fake");
      requests.push(`${req.method} ${url.pathname}`);
      const path = url.pathname;

      // OAuth consent screen: approves straight away and returns to the app.
      if (req.method === "GET" && path === "/o/oauth2/v2/auth") {
        const p = url.searchParams;
        if (p.get("client_id") !== CLIENT_ID || p.get("code_challenge_method") !== "S256" || p.get("access_type") !== "offline") return send(res, 400, { error: "invalid_request" });
        const back = new URL(p.get("redirect_uri")!);
        if (account.email === "deny") {
          back.searchParams.set("error", "access_denied");
        } else {
          const code = `code-${id()}`;
          const scopes = (p.get("scope") ?? "").split(" ").filter((s) => account.grantDrive || !s.endsWith("/drive.file"));
          codes.set(code, { challenge: p.get("code_challenge")!, scope: scopes.join(" "), redirectUri: back.toString() });
          back.searchParams.set("code", code);
        }
        back.searchParams.set("state", p.get("state")!);
        return send(res, 302, undefined, { Location: back.toString() });
      }

      if (req.method === "POST" && path === "/token") {
        const form = new URLSearchParams((await body(req)).toString());
        if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) return send(res, 401, { error: "invalid_client" });
        if (form.get("grant_type") === "authorization_code") {
          const entry = codes.get(form.get("code") ?? "");
          codes.delete(form.get("code") ?? "");
          const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
          if (!entry || entry.challenge !== challenge || entry.redirectUri.split("?")[0] !== form.get("redirect_uri")) return send(res, 400, { error: "invalid_grant", error_description: "Bad code or verifier" });
          const refresh = `rt-${id()}`;
          refreshTokens.set(refresh, { email: account.email, revoked: false });
          return send(res, 200, { access_token: issueAccess(account.email), refresh_token: refresh, expires_in: 3599, scope: entry.scope, token_type: "Bearer" });
        }
        if (form.get("grant_type") === "refresh_token") {
          const entry = refreshTokens.get(form.get("refresh_token") ?? "");
          if (!entry || entry.revoked) return send(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
          return send(res, 200, { access_token: issueAccess(entry.email), expires_in: 3599, token_type: "Bearer" });
        }
        return send(res, 400, { error: "unsupported_grant_type" });
      }

      if (req.method === "POST" && path === "/revoke") {
        const token = new URLSearchParams((await body(req)).toString()).get("token") ?? "";
        const entry = refreshTokens.get(token);
        if (entry) entry.revoked = true;
        accessTokens.delete(token);
        return send(res, 200, {});
      }

      const email = userOf(req);
      if (!email) return send(res, 401, { error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } });

      if (req.method === "GET" && path === "/oauth2/v3/userinfo") return send(res, 200, { email: email.toUpperCase(), email_verified: true });

      const parentsExist = (parents: string[] | undefined) => (parents ?? []).every((p) => files.has(p));

      if (req.method === "POST" && path === "/drive/v3/files") {
        const meta = JSON.parse((await body(req)).toString()) as { name: string; mimeType: string; parents?: string[] };
        if (!parentsExist(meta.parents)) return driveError(res, 404, `File not found: ${meta.parents}.`, "notFound");
        const file: FakeFile = { id: id(), name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [], bytes: Buffer.alloc(0) };
        files.set(file.id, file);
        permissions.set(file.id, [{ id: "owner", type: "user", role: "owner", emailAddress: email }]);
        return send(res, 200, view(file));
      }

      if (req.method === "POST" && path === "/upload/drive/v3/files") {
        if (url.searchParams.get("uploadType") !== "multipart") return send(res, 400, {});
        const { metadata, contentType, bytes } = parseMultipart(req.headers["content-type"] ?? "", await body(req));
        if (!parentsExist(metadata.parents)) return driveError(res, 404, `File not found: ${metadata.parents}.`, "notFound");
        const file: FakeFile = { id: id(), name: metadata.name, mimeType: contentType, parents: metadata.parents ?? [], bytes, description: metadata.description };
        files.set(file.id, file);
        permissions.set(file.id, [{ id: "owner", type: "user", role: "owner", emailAddress: email }]);
        return send(res, 200, view(file));
      }

      const fileMatch = /^\/drive\/v3\/files\/([^/]+)(\/permissions(?:\/([^/]+))?)?$/.exec(path);
      if (fileMatch) {
        const [, fileId, perms, permissionId] = fileMatch;
        const file = files.get(decodeURIComponent(fileId));
        if (!file) return driveError(res, 404, `File not found: ${fileId}.`, "notFound");
        if (!perms) {
          if (req.method === "GET" && url.searchParams.get("alt") === "media") return send(res, 200, file.bytes);
          if (req.method === "GET") return send(res, 200, { ...view(file), trashed: false });
          if (req.method === "DELETE") {
            files.delete(file.id);
            return send(res, 204);
          }
        } else {
          const list = permissions.get(file.id)!;
          if (req.method === "GET") return send(res, 200, { permissions: list });
          if (req.method === "POST") {
            const p = JSON.parse((await body(req)).toString()) as { type: string; role: string; emailAddress: string };
            if (p.emailAddress.endsWith("@nogoogle.test")) {
              return driveError(res, 400, "Bad Request. User message: \"You are trying to invite " + p.emailAddress + ". Since there is no Google account associated with this email address, you must check the 'Notify people' box to invite this recipient.\"", "invalidSharingRequest");
            }
            const permission = { id: `perm-${id()}`, type: p.type, role: p.role, emailAddress: p.emailAddress };
            list.push(permission);
            return send(res, 200, permission);
          }
          if (req.method === "DELETE" && permissionId) {
            const index = list.findIndex((p) => p.id === decodeURIComponent(permissionId));
            if (index === -1) return driveError(res, 404, "Permission not found", "notFound");
            list.splice(index, 1);
            return send(res, 204);
          }
        }
      }
      return send(res, 404, { error: { code: 404, message: `No fake for ${req.method} ${path}` } });
    } catch (error) {
      send(res, 500, { error: { code: 500, message: String(error) } });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    files,
    permissions,
    account,
    refreshTokens,
    requests,
    revokeAll: () => {
      for (const token of refreshTokens.values()) token.revoked = true;
      accessTokens.clear();
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** The files inside a folder, by name. */
export const childrenOf = (google: FakeGoogle, folderId: string) => [...google.files.values()].filter((f) => f.parents.includes(folderId));
/** Emails a file is shared with (not its owner). */
export const sharedWith = (google: FakeGoogle, fileId: string) =>
  (google.permissions.get(fileId) ?? []).filter((p) => p.role !== "owner").map((p) => p.emailAddress.toLowerCase()).sort();
