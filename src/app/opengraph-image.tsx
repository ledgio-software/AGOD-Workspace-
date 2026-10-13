import { ImageResponse } from "next/og";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";

// Phase 39: the picture shown when a page is shared (WhatsApp, X, LinkedIn, Slack...). One branded
// card for the whole site; drawn in code, so there is no image file to keep up to date.

export const alt = `${PRODUCT_NAME}: ${PRODUCT_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const initials = PRODUCT_NAME.split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "linear-gradient(135deg, #1e1b4b 0%, #4338ca 60%, #7c3aed 100%)", color: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ width: 96, height: 96, borderRadius: 24, background: "white", color: "#4338ca", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 700 }}>{initials}</div>
          <div style={{ display: "flex", gap: 0, height: 12, width: 180 }}>
            <div style={{ flex: 1, background: "#ce1126" }} />
            <div style={{ flex: 1, background: "#fcd116" }} />
            <div style={{ flex: 1, background: "#006b3f" }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>{PRODUCT_NAME}</div>
          <div style={{ fontSize: 36, opacity: 0.9 }}>{PRODUCT_TAGLINE}</div>
        </div>
        <div style={{ fontSize: 28, opacity: 0.8 }}>Projects · Articles · Tech news · Sessions · Mentors · Jobs</div>
      </div>
    ),
    size,
  );
}
