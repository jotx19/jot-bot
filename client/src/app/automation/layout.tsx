import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Automation",
  description:
    "Manage sandbox automation scripts saved from chat — schedule, run, and review your AI tools.",
  path: "/automation",
  index: false,
});

export default function AutomationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
