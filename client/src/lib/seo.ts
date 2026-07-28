import type { Metadata } from "next";

const FALLBACK_SITE_URL = "https://tinyjot.jotx.space";

export const siteConfig = {
  name: "tinyjot",
  shortName: "tinyjot",
  tagline: "Your personal AI, ready when you are.",
  description:
    "tinyjot is a personal AI runtime with chat, persistent memory, tools, Google Health, automation, and Discord — private and ready when you are.",
  locale: "en_US",
  twitterHandle: "",
  keywords: [
    "tinyjot",
    "personal AI",
    "AI chatbot",
    "AI runtime",
    "persistent memory",
    "Discord AI bot",
    "Google Health",
    "automation",
    "MCP",
    "open source AI",
  ],
} as const;

export function getSiteUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.VERCEL_URL;
  if (!fromEnv) return FALLBACK_SITE_URL;
  const raw = fromEnv.startsWith("http") ? fromEnv : `https://${fromEnv}`;
  return raw.replace(/\/$/, "");
}

type PageSeoInput = {
  title: string;
  description?: string;
  path?: string;
  /** Public marketing pages should be indexed; app shells should not. */
  index?: boolean;
  keywords?: string[];
};

export function createPageMetadata({
  title,
  description = siteConfig.description,
  path = "/",
  index = true,
  keywords,
}: PageSeoInput): Metadata {
  const siteUrl = getSiteUrl();
  const url =
    path === "/"
      ? siteUrl
      : `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const fullTitle =
    title === siteConfig.name ? title : `${title} · ${siteConfig.name}`;

  return {
    title,
    description,
    keywords: keywords ?? [...siteConfig.keywords],
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      locale: siteConfig.locale,
      url,
      siteName: siteConfig.name,
      title: fullTitle,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      ...(siteConfig.twitterHandle
        ? { creator: siteConfig.twitterHandle, site: siteConfig.twitterHandle }
        : {}),
    },
    robots: index
      ? {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        }
      : {
          index: false,
          follow: false,
          nocache: true,
          googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
          },
        },
  };
}

export function organizationJsonLd() {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteConfig.name,
    applicationCategory: "ProductivityApplication",
    operatingSystem: "Web",
    description: siteConfig.description,
    url: siteUrl,
    image: `${siteUrl}/opengraph-image`,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteUrl,
    },
  };
}

export function websiteJsonLd() {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteUrl,
    description: siteConfig.description,
    inLanguage: "en",
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/icon-512.png`,
      },
    },
  };
}
