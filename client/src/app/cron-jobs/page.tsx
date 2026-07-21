"use client";

import { AppShell } from "@/components/app-shell";
import { EmptyChat } from "@/components/chat/empty-chat";

export default function CronJobsPage() {
  return (
    <AppShell>
      <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col p-2">
        <EmptyChat
          title="Cron jobs"
          description="Recurring tasks and interval runners will show up here."
        />
      </div>
    </AppShell>
  );
}
