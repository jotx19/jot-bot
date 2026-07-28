import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Automation",
  description:
    "Install vetted sandbox scripts from the script library — schedule, pause, and review runs.",
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
