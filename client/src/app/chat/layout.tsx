import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Chat",
  description:
    "Chat with your personal AI runtime — memory, tools, and Discord in one place.",
  path: "/chat",
  index: false,
});

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
