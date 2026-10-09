import type { Metadata } from "next";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";
import { resolveBaseUrl } from "@/lib/env";

// Phase 39: search engines and link previews. The public community pages are made for sharing and
// for Google; company workspaces and signed-in pages are never indexed.

type Source = Record<string, string | undefined>;

export const SITE_DESCRIPTION =
  "Ghana's community for people who build software, by hand or with AI: share projects and get feedback, read articles and tech news, join live sessions, find mentors, jobs and teammates.";

/**
 * The site's address (origin only, no trailing slash), or null when it isn't known or can't be
 * read. A value without a scheme ("gvcd.example") is taken as https; an unreadable one gives null
 * instead of an error, since this runs while pages are built and a bad setting must not break that.
 */
export function siteUrl(source: Source = process.env): string | null {
  const raw = resolveBaseUrl(source)?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Only the production site is indexed: Vercel previews and staging (VERCEL_ENV=preview) ask search
 * engines to stay away, so test copies never show up in results. SEARCH_INDEXING=off turns it off
 * on production too; outside Vercel, production builds are indexed.
 */
export function indexingAllowed(source: Source = process.env): boolean {
  if (source.SEARCH_INDEXING?.trim().toLowerCase() === "off") return false;
  if (source.VERCEL_ENV) return source.VERCEL_ENV === "production";
  return source.NODE_ENV === "production";
}

/** Signed-in areas: not indexed and not crawled. */
export const PRIVATE_PATHS = ["/community", "/api/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/no-company"];

// The branded picture from app/opengraph-image.tsx. A page that sets its own Open Graph details
// replaces the site-wide ones, so each page names the picture again.
const PREVIEW_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: `${PRODUCT_NAME}: ${PRODUCT_TAGLINE}` };

/** A page's title and description, also used for its link preview (WhatsApp, X, LinkedIn...). */
export function pageMetadata(title: string, description?: string | null, extra: { type?: "website" | "article"; publishedTime?: Date | null } = {}): Metadata {
  const desc = description ? clip(description, 200) : undefined;
  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      siteName: PRODUCT_NAME,
      type: extra.type ?? "website",
      locale: "en_GH",
      images: [PREVIEW_IMAGE],
      ...(extra.type === "article" && extra.publishedTime ? { publishedTime: extra.publishedTime.toISOString() } : {}),
    },
    twitter: { card: "summary_large_image", title, description: desc, images: [PREVIEW_IMAGE] },
  };
}

/** One line of plain text, cut at a word near `max` characters. */
export function clip(text: string, max: number): string {
  const line = text.replace(/[#*_`>[\]]/g, "").replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).trimEnd()}…`;
}

export const defaultTitle = `${PRODUCT_NAME}: ${PRODUCT_TAGLINE}`;
