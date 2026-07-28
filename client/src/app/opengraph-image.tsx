import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/seo";

export const runtime = "edge";
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(145deg, #0A0A0A 0%, #1C1C1C 55%, #0F1F1C 100%)",
          color: "#F5F5F7",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "#34d399",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0A0A0A",
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            t
          </div>
          {siteConfig.name}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 650,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              maxWidth: 900,
            }}
          >
            {siteConfig.tagline}
          </div>
          <div
            style={{
              fontSize: 26,
              lineHeight: 1.4,
              color: "rgba(245,245,247,0.72)",
              maxWidth: 820,
            }}
          >
            Chat, memory, tools, Google Health, automation, and Discord — a
            private AI runtime that stays yours.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: "rgba(245,245,247,0.5)",
            letterSpacing: "0.04em",
          }}
        >
          PERSONAL AI RUNTIME
        </div>
      </div>
    ),
    { ...size }
  );
}
