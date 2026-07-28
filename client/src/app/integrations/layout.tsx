import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Integrations",
  description:
    "Connect Google Health, MCP servers, Notion, filesystem tools, and more to tinyjot.",
  path: "/integrations",
  index: false,
});

export default function IntegrationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
