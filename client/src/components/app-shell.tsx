"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { AppSidebar } from "@/components/app-sidebar";
import { SettingsDialog } from "@/components/settings-dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const setSession = useAuthStore((s) => s.setSession);
  const setGoogleClientId = useAuthStore((s) => s.setGoogleClientId);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.get("/api/auth/me");
        if (cancelled) return;
        if (data.googleClientId) setGoogleClientId(data.googleClientId);
        if (data.authenticated && data.user) {
          setSession(data.user, accessToken);
        } else if (!data.user) {
          router.replace("/login");
        }
      } catch {
        if (!cancelled) router.replace("/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, accessToken, router, setSession, setGoogleClientId]);

  if (!hydrated || !user) {
    return (
      <div className="flex min-h-svh w-full">
        <div className="hidden w-64 shrink-0 border-r border-border/40 p-3 md:block">
          <div className="mb-6 flex justify-center py-1">
            <Skeleton className="size-6 rounded-md" />
          </div>
          <Skeleton className="mb-3 h-10 w-full rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
          <div className="mt-6 space-y-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <div className="flex justify-between">
            <Skeleton className="h-9 w-40 rounded-full" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
          <div className="mx-auto mt-10 flex w-full max-w-2xl flex-col gap-3">
            <Skeleton className="h-12 w-2/3 self-end rounded-2xl" />
            <Skeleton className="h-16 w-3/4 rounded-2xl" />
            <Skeleton className="h-12 w-1/2 self-end rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh w-full text-foreground">
      <AppSidebar>{children}</AppSidebar>
      <SettingsDialog />
    </div>
  );
}
