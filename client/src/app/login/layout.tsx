import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Sign in",
  description:
    "Sign in to tinyjot to access your personal AI chat, memory, tools, Google Health, and Discord bridge.",
  path: "/login",
  index: true,
});

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
