// Pure helpers for GitHub references: task keys, GitHub URLs and branch names.

/** Task key: project code + task number, e.g. AGOD-2026-005-T3. Used in branches, PR titles and issues. */
export function taskKey(projectCode: string, taskNumber: number): string {
  return `${projectCode}-T${taskNumber}`;
}

const KEY_PATTERN = /\b(AGOD-\d{4}-\d{3,})-T(\d{1,5})\b/gi;

/** Every task key mentioned in the text (branch name, title or body), without duplicates. */
export function findTaskKeys(...texts: (string | null | undefined)[]): { projectCode: string; number: number }[] {
  const found = new Map<string, { projectCode: string; number: number }>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(KEY_PATTERN)) {
      const projectCode = m[1].toUpperCase();
      const number = Number(m[2]);
      found.set(`${projectCode}-T${number}`, { projectCode, number });
    }
  }
  return [...found.values()];
}

/** Suggested branch name, following docs/GIT_WORKFLOW.md (area/key-short-title). */
export function suggestedBranch(area: "frontend" | "backend", key: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${area}/${key}${slug ? `-${slug}` : ""}`;
}

export type GithubRef =
  | { kind: "ISSUE" | "PULL_REQUEST"; repo: string; number: number; url: string }
  | { kind: "COMMIT" | "BRANCH"; repo: string; ref: string; url: string };

const REPO = "([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)";

/** Parses a github.com link to an issue, pull request, commit or branch. */
export function parseGithubUrl(input: string): GithubRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || (url.hostname !== "github.com" && url.hostname !== "www.github.com")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  const repoOf = (owner: string, name: string) => `${owner}/${name.replace(/\.git$/, "")}`.toLowerCase();
  let m = new RegExp(`^/${REPO}/(issues|pull)/(\\d+)`).exec(path);
  if (m) {
    const repo = repoOf(m[1], m[2]);
    const kind = m[3] === "pull" ? "PULL_REQUEST" : "ISSUE";
    const number = Number(m[4]);
    return { kind, repo, number, url: `https://github.com/${repo}/${m[3]}/${number}` };
  }
  m = new RegExp(`^/${REPO}/commit/([0-9a-f]{7,40})$`, "i").exec(path);
  if (m) {
    const repo = repoOf(m[1], m[2]);
    return { kind: "COMMIT", repo, ref: m[3].toLowerCase(), url: `https://github.com/${repo}/commit/${m[3].toLowerCase()}` };
  }
  m = new RegExp(`^/${REPO}/tree/(.+)$`).exec(path);
  if (m) {
    const repo = repoOf(m[1], m[2]);
    const ref = decodeURIComponent(m[3]);
    return { kind: "BRANCH", repo, ref, url: `https://github.com/${repo}/tree/${encodeURI(ref)}` };
  }
  return null;
}

export function linkKey(ref: GithubRef): string {
  return "number" in ref ? `${ref.kind}:${ref.repo}#${ref.number}` : `${ref.kind}:${ref.repo}@${ref.ref}`;
}

/** "owner/name" as typed by a person, normalised; null when empty, undefined when invalid. */
export function normaliseRepo(input: string): string | null | undefined {
  const value = input.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
  if (!value) return null;
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(value) ? value : undefined;
}
