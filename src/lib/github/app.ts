import "server-only";
import { createSign } from "node:crypto";

// GitHub App authentication (decision: Phase 8 uses a GitHub App on the AGOD organisation).
// The app signs a short-lived JWT with its private key, exchanges it for an installation token,
// and calls the REST API with that token. Nothing here runs unless all settings are present.

export type GithubAppConfig = { appId: string; privateKey: string; webhookSecret: string; installationId: string | null };

export function githubConfig(source: Record<string, string | undefined> = process.env): GithubAppConfig | null {
  const appId = source.GITHUB_APP_ID?.trim();
  // Vercel stores multi-line values as-is; a value pasted with literal "\n" also works.
  const privateKey = source.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const webhookSecret = source.GITHUB_WEBHOOK_SECRET?.trim();
  if (!appId || !privateKey || !webhookSecret) return null;
  return { appId, privateKey, webhookSecret, installationId: source.GITHUB_APP_INSTALLATION_ID?.trim() || null };
}

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** App JWT (RS256), valid for 9 minutes, issued 60 s in the past to allow for clock drift. */
export function createAppJwt(appId: string, privateKey: string, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

const API = "https://api.github.com";
const headers = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "agod-payout-tracker",
});

let cached: { token: string; expiresAt: number; installationId: string } | null = null;

async function installationIdFor(config: GithubAppConfig, repo: string): Promise<string> {
  if (config.installationId) return config.installationId;
  const res = await fetch(`${API}/repos/${repo}/installation`, { headers: headers(createAppJwt(config.appId, config.privateKey)) });
  if (!res.ok) throw new Error(`The GitHub App is not installed on ${repo} (GitHub answered ${res.status}).`);
  return String(((await res.json()) as { id: number }).id);
}

async function installationToken(config: GithubAppConfig, repo: string): Promise<string> {
  const installationId = await installationIdFor(config, repo);
  if (cached && cached.installationId === installationId && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: headers(createAppJwt(config.appId, config.privateKey)),
  });
  if (!res.ok) throw new Error(`GitHub refused an installation token (${res.status}). Check the app ID and private key.`);
  const body = (await res.json()) as { token: string; expires_at: string };
  cached = { token: body.token, expiresAt: Date.parse(body.expires_at), installationId };
  return body.token;
}

/** Calls the GitHub REST API for a repository the app is installed on. */
export async function githubRequest<T>(repo: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const config = githubConfig();
  if (!config) throw new Error("The GitHub App is not configured.");
  const token = await installationToken(config, repo);
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { ...headers(token), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${init.method ?? "GET"} ${path}.`);
  return (await res.json()) as T;
}

/** For the integration page: the app's identity, proving the ID and key are right. */
export async function checkGithubApp(): Promise<{ ok: true; name: string; owner: string } | { ok: false; error: string }> {
  const config = githubConfig();
  if (!config) return { ok: false, error: "Not configured: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are needed." };
  try {
    const res = await fetch(`${API}/app`, { headers: headers(createAppJwt(config.appId, config.privateKey)) });
    if (!res.ok) return { ok: false, error: `GitHub answered ${res.status}. Check the app ID and private key.` };
    const app = (await res.json()) as { name: string; owner?: { login: string } };
    return { ok: true, name: app.name, owner: app.owner?.login ?? "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach GitHub." };
  }
}
