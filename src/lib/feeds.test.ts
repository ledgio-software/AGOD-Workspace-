import { describe, expect, it } from "vitest";
import { httpsLink, parseFeed, plainText } from "./feeds";

const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Site</title>
  <item>
    <title><![CDATA[Ghana's startups & AI]]></title>
    <link>https://example.com/a?x=1&amp;y=2</link>
    <description><![CDATA[<p>First <b>paragraph</b>.</p><script>alert(1)</script><img src="x">]]></description>
    <pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Escaped HTML</title>
    <link>https://example.com/b</link>
    <description>&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</description>
  </item>
  <item><title>Not https</title><link>http://example.com/c</link></item>
  <item><title>Script link</title><link>javascript:alert(1)</link></item>
  <item><title></title><link>https://example.com/no-title</link></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
  <entry>
    <title type="html">Release &amp;lt;v2&amp;gt;</title>
    <link rel="self" href="https://example.com/self.xml"/>
    <link rel="alternate" type="text/html" href="https://example.com/post"/>
    <updated>2026-10-07T09:30:00Z</updated>
    <summary>Short summary</summary>
  </entry>
  <entry>
    <title>Only a bare link</title>
    <link href="https://example.com/bare" />
    <published>not a date</published>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("reads RSS items, keeps only titled https entries and strips HTML", () => {
    const entries = parseFeed(rss);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      title: "Ghana's startups & AI",
      url: "https://example.com/a?x=1&y=2",
      summary: "First paragraph .",
      publishedAt: new Date("2026-10-08T10:00:00Z"),
    });
    expect(entries[1].summary).toBe("Hello & welcome");
    expect(entries[1].publishedAt).toBeNull();
  });

  it("reads Atom entries and prefers the alternate link", () => {
    const entries = parseFeed(atom);
    expect(entries.map((e) => e.url)).toEqual(["https://example.com/post", "https://example.com/bare"]);
    expect(entries[0].title).toBe("Release <v2>");
    expect(entries[0].publishedAt).toEqual(new Date("2026-10-07T09:30:00Z"));
    expect(entries[1].publishedAt).toBeNull();
    expect(entries[1].summary).toBeNull();
  });

  it("stops at the limit", () => {
    expect(parseFeed(rss, 1)).toHaveLength(1);
  });

  it("returns nothing for something that isn't a feed", () => {
    expect(parseFeed("<html><body>Blocked</body></html>")).toEqual([]);
  });
});

describe("plainText and httpsLink", () => {
  it("shortens long text with an ellipsis", () => {
    expect(plainText("word ".repeat(100), 20)).toHaveLength(20);
    expect(plainText("word ".repeat(100), 20).endsWith("…")).toBe(true);
  });

  it("decodes numeric entities", () => {
    expect(plainText("caf&#233; &#x2014; ok")).toBe("café — ok");
  });

  it("accepts only https links", () => {
    expect(httpsLink("https://a.com/x")).toBe("https://a.com/x");
    expect(httpsLink("http://a.com/x")).toBeNull();
    expect(httpsLink("data:text/html,hi")).toBeNull();
    expect(httpsLink("not a url")).toBeNull();
  });
});
