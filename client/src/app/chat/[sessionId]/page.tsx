"use client";

import { AppShell } from "@/components/app-shell";
import { ChatView } from "@/components/chat-view";

export default function ChatSessionPage() {
  return (
    <AppShell>
      <ChatView />
    </AppShell>
  );
}
