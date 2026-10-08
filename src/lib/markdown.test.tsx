import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, parseBlocks, readingMinutes } from "./markdown";

const html = (s: string) => renderToStaticMarkup(<Markdown source={s} />);

describe("markdown for articles", () => {
  it("blocks: headings, lists, quotes, code and rules", () => {
    expect(parseBlocks("# Title\n\nA para\nsame para\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```ts\nconst a = 1;\n```\n\n---").map((b) => b.kind)).toEqual([
      "h", "p", "ul", "ol", "quote", "code", "hr",
    ]);
    expect(parseBlocks("A para\nsame para")[0]).toEqual({ kind: "p", text: "A para same para" });
  });

  it("inline formatting and safe links", () => {
    const out = html("**bold** _it_ `x < 1` [site](https://ghana.dev) [bad](javascript:alert(1)) [local](/library)");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>it</em>");
    expect(out).toContain("<code");
    expect(out).toContain("x &lt; 1");
    expect(out).toContain('href="https://ghana.dev"');
    expect(out).not.toMatch(/href="javascript/);
    expect(out).toContain("[bad](javascript:alert(1)");
    expect(out).toContain('href="/library"');
  });

  it("never lets HTML through", () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n```\n<b>raw</b>\n```');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;b&gt;raw&lt;/b&gt;");
  });

  it("reading time", () => {
    expect(readingMinutes("word ".repeat(50))).toBe(1);
    expect(readingMinutes("word ".repeat(1000))).toBe(5);
  });
});
