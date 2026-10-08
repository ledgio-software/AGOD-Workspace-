// Phase 35: turns a YouTube, Vimeo, Loom or Google Drive link into a player that plays on the page.
// Only these hosts, and only well-formed ids, so nothing else can be framed.

export type VideoEmbed = { provider: "YouTube" | "Vimeo" | "Loom" | "Google Drive"; embedUrl: string; thumbnail: string | null };

export function videoEmbed(raw: string | null | undefined): VideoEmbed | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^(www|m)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const ok = (id: string | undefined, pattern: RegExp) => (id && pattern.test(id) ? id : null);

  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
    const id =
      host === "youtu.be"
        ? ok(parts[0], /^[\w-]{11}$/)
        : parts[0] === "watch"
          ? ok(url.searchParams.get("v") ?? undefined, /^[\w-]{11}$/)
          : ["shorts", "embed", "live"].includes(parts[0])
            ? ok(parts[1], /^[\w-]{11}$/)
            : null;
    return id ? { provider: "YouTube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1`, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = ok(parts.find((p) => /^\d+$/.test(p)), /^\d{5,12}$/);
    return id ? { provider: "Vimeo", embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1`, thumbnail: null } : null;
  }
  if (host === "loom.com") {
    const id = ["share", "embed"].includes(parts[0]) ? ok(parts[1], /^[0-9a-f]{32}$/) : null;
    return id ? { provider: "Loom", embedUrl: `https://www.loom.com/embed/${id}?autoplay=1`, thumbnail: null } : null;
  }
  if (host === "drive.google.com") {
    const id = parts[0] === "file" && parts[1] === "d" ? ok(parts[2], /^[\w-]{20,80}$/) : null;
    return id ? { provider: "Google Drive", embedUrl: `https://drive.google.com/file/d/${id}/preview`, thumbnail: null } : null;
  }
  return null;
}
