import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/brand";
import { SITE_DESCRIPTION, defaultTitle, indexingAllowed, siteUrl } from "@/lib/site";
import "./globals.css";

const base = siteUrl();

// Phase 39: titles read "Page · Ghana Vibe Coders & Developers"; every page has a description and
// a link preview (the picture is app/opengraph-image.tsx). Only production is indexed.
export const metadata: Metadata = {
  ...(base ? { metadataBase: new URL(base) } : {}),
  title: { default: defaultTitle, template: `%s · ${PRODUCT_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  openGraph: { siteName: PRODUCT_NAME, type: "website", locale: "en_GH", title: defaultTitle, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: defaultTitle, description: SITE_DESCRIPTION },
  robots: indexingAllowed() ? { index: true, follow: true } : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
