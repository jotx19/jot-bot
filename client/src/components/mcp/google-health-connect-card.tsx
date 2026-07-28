"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type GoogleHealthStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GoogleHealthLogo } from "@/components/health/google-health-logo";
import { cn, panelBg } from "@/lib/utils";
import { toast } from "sonner";

type GoogleHealthConnectCardProps = {
  variant?: "page" | "settings";
};

export function GoogleHealthConnectCard({
  variant = "page",
}: GoogleHealthConnectCardProps) {
  const qc = useQueryClient();
  const isPage = variant === "page";
  const [connecting, setConnecting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings");
      return data;
    },
  });

  const health: GoogleHealthStatus | undefined =
    data?.user?.settings?.googleHealth || data?.googleHealthOAuth;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("health");
    if (!status) return;
    if (status === "connected") {
      toast.success("Google Health connected");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
    } else if (status === "error") {
      toast.error(params.get("message") || "Google Health connection failed");
    }
    params.delete("health");
    params.delete("message");
    const next = params.toString();
    const url = `${window.location.pathname}${next ? `?${next}` : ""}`;
    window.history.replaceState({}, "", url);
  }, [qc]);

  const disconnect = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete("/api/integrations/google-health");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      toast.success("Google Health disconnected");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const connect = async () => {
    setConnecting(true);
    try {
      const { data: res } = await api.get<{ url: string }>(
        "/api/integrations/google-health/connect"
      );
      if (!res?.url) throw new Error("No Google authorize URL returned");
      window.location.href = res.url;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start Google Health connect"
      );
      setConnecting(false);
    }
  };

  const loadSummary = async () => {
    try {
      const { data: res } = await api.get<{ markdown?: string }>(
        "/api/integrations/google-health/summary"
      );
      toast.success("Today’s health data loaded — ask in chat with /health");
      if (res?.markdown) {
        console.info("[google-health summary]\n", res.markdown);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not fetch Google Health data"
      );
    }
  };

  if (isLoading) {
    return (
      <Skeleton className={cn(isPage ? "h-28 rounded-2xl" : "h-24 rounded-xl")} />
    );
  }

  const available = health?.oauthAvailable !== false;
  const connected = Boolean(health?.connected);

  return (
    <div
      className={cn(
        isPage
          ? cn("rounded-2xl px-4 py-4", panelBg)
          : "rounded-xl border border-white/10 bg-white/5 p-3"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <GoogleHealthLogo size={28} className="rounded-lg" />
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight">
                Google Health
              </h3>
              {connected ? (
                <Badge variant="secondary" className="rounded-md text-[10px]">
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="rounded-md text-[10px]">
                  Not connected
                </Badge>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect via Google OAuth to read Fitbit / Pixel Watch data (steps,
            sleep, heart rate). Then use{" "}
            <span className="font-mono text-[11px]">/health</span> in chat.
          </p>
          {!available ? (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Add GOOGLE_CLIENT_SECRET next to GOOGLE_CLIENT_ID (same OAuth Web
              client). Enable Google Health API in Cloud Console.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() => void loadSummary()}
              >
                Fetch today
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              className="rounded-lg"
              disabled={!available || connecting}
              onClick={() => void connect()}
            >
              {connecting ? "Redirecting…" : "Connect Google Health"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
