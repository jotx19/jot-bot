"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { TinyjotLogo } from "@/components/tinyjot-logo";

export default function HomePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    router.replace(user ? "/chat" : "/login");
  }, [hydrated, user, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <TinyjotLogo size="xl" />
      <Skeleton className="h-4 w-40 rounded-md" />
      <Skeleton className="mt-2 h-11 w-64 max-w-full rounded-xl" />
    </div>
  );
}
