import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, indexingAllowed, siteUrl } from "@/lib/site";

// Phase 39: production lets search engines read the public community pages (and points them to
// the sitemap); previews and staging ask them to stay away entirely.

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  if (!indexingAllowed()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
