import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const now = new Date();

  const publicRoutes: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority: number;
  }> = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/login", changeFrequency: "monthly", priority: 0.8 },
    { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
    { path: "/terms", changeFrequency: "yearly", priority: 0.4 },
    { path: "/contact", changeFrequency: "yearly", priority: 0.5 },
  ];

  return publicRoutes.map((route) => ({
    url: route.path === "/" ? siteUrl : `${siteUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
