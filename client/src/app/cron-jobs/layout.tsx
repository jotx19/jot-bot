import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Cron jobs",
  description: "Recurring tasks and interval runners in tinyjot.",
  path: "/cron-jobs",
  index: false,
});

export default function CronJobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
