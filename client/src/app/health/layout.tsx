import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Health",
  description:
    "View Google Health metrics from your Fitbit or Pixel Watch — steps, sleep, heart rate, and active zones.",
  path: "/health",
  index: false,
  keywords: [
    "Google Health",
    "Fitbit",
    "Pixel Watch",
    "health dashboard",
    "tinyjot",
  ],
});

export default function HealthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
