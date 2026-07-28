import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Settings",
  description: "Configure tinyjot identity, BYOK keys, Discord, and preferences.",
  path: "/settings",
  index: false,
});

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
