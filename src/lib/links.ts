// Phase 21: links to files kept elsewhere (Google Docs, Sheets, Slides, Drive files and folders,
// or any https page), added to a project or a task.

export type LinkProvider = "GOOGLE_DRIVE" | "WEB";

export type CheckedLink = { url: string; provider: LinkProvider; suggestedTitle: string };

const DRIVE_HOSTS = new Set(["docs.google.com", "drive.google.com"]);

function driveKind(path: string): string {
  if (path.startsWith("/document/")) return "Google Doc";
  if (path.startsWith("/spreadsheets/")) return "Google Sheet";
  if (path.startsWith("/presentation/")) return "Google Slides";
  if (path.startsWith("/forms/")) return "Google Form";
  if (path.includes("/folders/")) return "Drive folder";
  return "Drive file";
}

/** Checks a pasted link: https only, no credentials, reasonable length. Returns an error message otherwise. */
export function checkLink(input: string): CheckedLink | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Paste a link." };
  if (raw.length > 2000) return { error: "That link is too long." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "That doesn't look like a link. Copy it from the browser's address bar." };
  }
  if (url.protocol !== "https:") return { error: "Only https:// links can be added." };
  if (url.username || url.password) return { error: "Links with a username or password in them can't be added." };
  const host = url.hostname.toLowerCase();
  if (DRIVE_HOSTS.has(host)) return { url: url.toString(), provider: "GOOGLE_DRIVE", suggestedTitle: driveKind(url.pathname) };
  return { url: url.toString(), provider: "WEB", suggestedTitle: host.replace(/^www\./, "") };
}
