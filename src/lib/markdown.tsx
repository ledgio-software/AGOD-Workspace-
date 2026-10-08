import type { ReactNode } from "react";

// Phase 37: a small Markdown subset for articles, turned straight into React elements (never into
// HTML strings), so nothing an author writes can run as code in a reader's browser.
//   # / ## / ### headings, paragraphs, blank-line separated
//   - or * lists, 1. numbered lists, > quotes, ``` code blocks ```, --- rules
//   **bold**, _italic_ or *italic*, `code`, [text](https://link)
// Links must be https (or relative paths on this site); anything else is shown as plain text.

type Block =
  | { kind: "h"; level: 2 | 3 | 4; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "hr" };

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end of text)
      blocks.push({ kind: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      // An article's own title is the page's h1, so "#" becomes h2.
      blocks.push({ kind: "h", level: (heading[1].length + 1) as 2 | 3 | 4, text: heading[2] });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) items.push(pattern.exec(lines[i++])![1]);
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: body.join(" ") });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(```|#{1,3}\s|>\s?|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i]) && !/^(-{3,}|\*{3,})\s*$/.test(lines[i])) {
      para.push(lines[i++].trim());
    }
    if (para.length === 0) {
      // A line that looked like a block start but wasn't (e.g. "#hashtag"): keep it as text.
      para.push(lines[i++].trim());
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

const safeHref = (href: string) => (/^https:\/\/[^\s]+$/i.test(href) || /^\/[\w\-/?=&#%.]*$/.test(href) ? href : null);

/** Inline formatting: code first (its content stays literal), then links, bold, italic. */
export function inline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*)_(?![\w_])/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${n++}`;
    if (m[1] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.9em]">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      const href = safeHref(m[3]);
      out.push(
        href ? (
          <a key={key} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="nofollow ugc noopener noreferrer" className="text-brand-600 underline dark:text-brand-400">
            {inline(m[2], key)}
          </a>
        ) : (
          m[0]
        ),
      );
    } else if (m[4] !== undefined) {
      out.push(<strong key={key}>{inline(m[4], key)}</strong>);
    } else {
      out.push(<em key={key}>{inline(m[5] ?? m[6], key)}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-4 text-[15px] leading-7">
      {parseBlocks(source).map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case "h":
            return b.level === 2 ? (
              <h2 key={k} className="pt-2 text-xl font-semibold tracking-tight">
                {inline(b.text, k)}
              </h2>
            ) : b.level === 3 ? (
              <h3 key={k} className="pt-1 text-lg font-semibold">
                {inline(b.text, k)}
              </h3>
            ) : (
              <h4 key={k} className="font-semibold">
                {inline(b.text, k)}
              </h4>
            );
          case "ul":
          case "ol": {
            const List = b.kind;
            return (
              <List key={k} className={b.kind === "ul" ? "list-disc space-y-1 pl-6" : "list-decimal space-y-1 pl-6"}>
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item, `${k}-${j}`)}</li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <blockquote key={k} className="border-l-4 border-brand-300 pl-4 italic text-muted">
                {inline(b.text, k)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={k} className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm leading-6 text-zinc-100" data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            );
          case "hr":
            return <hr key={k} className="border-line" />;
          default:
            return <p key={k}>{inline(b.text, k)}</p>;
        }
      })}
    </div>
  );
}

/** About how long the text takes to read (200 words a minute), at least 1 minute. */
export function readingMinutes(source: string): number {
  return Math.max(1, Math.round(source.split(/\s+/).filter(Boolean).length / 200));
}
