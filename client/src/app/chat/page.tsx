"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ChatIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/chat/${crypto.randomUUID()}`);
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Starting chat…
    </div>
  );
}
