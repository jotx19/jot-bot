"use client";

import { AppShell } from "@/components/app-shell";
import { EmptyChat } from "@/components/chat/empty-chat";

export default function ScheduledPage() {
  return (
    <AppShell>
      <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col p-2">
        <EmptyChat
          title="Scheduled"
          description="One-off and calendar-based scheduled runs will appear here."
        />
      </div>
    </AppShell>
  );
}
