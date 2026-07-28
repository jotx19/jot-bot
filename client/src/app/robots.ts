import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/privacy", "/terms", "/contact"],
        disallow: [
          "/chat",
          "/chat/",
          "/health",
          "/automation",
          "/integrations",
          "/settings",
          "/scheduled",
          "/cron-jobs",
          "/api/",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
