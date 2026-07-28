import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Scheduled",
  description: "One-off and calendar-based scheduled runs in tinyjot.",
  path: "/scheduled",
  index: false,
});

export default function ScheduledLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
