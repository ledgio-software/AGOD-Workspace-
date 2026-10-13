// Phase 38: a small reader for RSS 2.0 and Atom news feeds, so the news page needs no XML library.
// It only pulls out what a headline needs (title, link, date, a short plain-text summary) and
// never keeps any HTML from the feed: summaries are stripped to text before they are stored.

export type FeedEntry = { title: string; url: string; summary: string | null; publishedAt: Date | null };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Feed text (maybe CDATA, maybe escaped HTML) to one line of plain text. */
export function plainText(raw: string, max = 280): string {
  // Two layers: the XML text (CDATA kept as is, the rest entity-decoded) is HTML, whose tags are
  // stripped and whose own entities are then decoded.
  const html = raw
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) => (part.startsWith("<![CDATA[") ? part.slice(9, -3) : decodeEntities(part)))
    .join("");
  const text = decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const tag = (block: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1] ?? null;

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1] ?? null;
  const alternate = links.find((a) => (attr(a, "rel") ?? "alternate") === "alternate") ?? links[0];
  return alternate ? attr(alternate, "href") : null;
}

function date(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(plainText(raw, 100));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Only https links are kept (others are dropped), so nothing else can end up as a link. */
export function httpsLink(raw: string | null): string | null {
  if (!raw) return null;
  const url = decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
  try {
    const u = new URL(url);
    return u.protocol === "https:" && url.length <= 2000 ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Reads an RSS 2.0 or Atom document; entries without a title or an https link are skipped. */
export function parseFeed(xml: string, limit = 30): FeedEntry[] {
  const atom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entries: FeedEntry[] = [];
  for (const block of blocks) {
    const title = plainText(tag(block, "title") ?? "", 200);
    const url = httpsLink(atom ? atomLink(block) : (tag(block, "link") ?? tag(block, "guid")));
    if (!title || !url) continue;
    const summaryRaw = atom ? (tag(block, "summary") ?? tag(block, "content")) : (tag(block, "description") ?? tag(block, "content:encoded"));
    const summary = summaryRaw ? plainText(summaryRaw) || null : null;
    const publishedAt = date(atom ? (tag(block, "published") ?? tag(block, "updated")) : (tag(block, "pubDate") ?? tag(block, "dc:date")));
    entries.push({ title, url, summary, publishedAt });
    if (entries.length >= limit) break;
  }
  return entries;
}
