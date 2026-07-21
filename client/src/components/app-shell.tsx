"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/app-store";
import { api } from "@/lib/api";
import { AppSidebar } from "@/components/app-sidebar";
import { SettingsDialog } from "@/components/settings-dialog";

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
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
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
