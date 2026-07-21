"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChatUiStore } from "@/stores/app-store";

/** Legacy route — opens settings dialog on /chat instead. */
export default function SettingsPage() {
  const router = useRouter();
  const setSettingsOpen = useChatUiStore((s) => s.setSettingsOpen);

  useEffect(() => {
    setSettingsOpen(true);
    router.replace("/chat");
  }, [router, setSettingsOpen]);

  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Opening settings…
    </div>
  );
}
