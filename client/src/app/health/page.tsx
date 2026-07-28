"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { GoogleHealthLogo } from "@/components/health/google-health-logo";
import { HealthDashboard } from "@/components/health/health-dashboard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type GoogleHealthStatus, type HealthSnapshot } from "@/lib/api";
import { cn, panelBg } from "@/lib/utils";

async function fetchHealthSummary() {
  const { data } = await api.get<{
    ok: boolean;
    snapshot: HealthSnapshot;
  }>("/api/integrations/google-health/summary", {
    params: { _: Date.now() },
    timeout: 60_000,
  });
  return data;
}

export default function HealthPage() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings");
      return data;
    },
  });

  const healthStatus: GoogleHealthStatus | undefined =
    settingsQuery.data?.user?.settings?.googleHealth ||
    settingsQuery.data?.googleHealthOAuth;

  const connected = Boolean(healthStatus?.connected);
  const oauthAvailable = healthStatus?.oauthAvailable !== false;

  const summaryQuery = useQuery({
    queryKey: ["google-health-summary"],
    queryFn: fetchHealthSummary,
    enabled: connected,
    retry: false,
    staleTime: 0,
  });

  const snap = summaryQuery.data?.snapshot;
  const isLoading =
    settingsQuery.isLoading || (connected && summaryQuery.isLoading);
  const isBusy =
    refreshing || settingsQuery.isFetching || summaryQuery.isFetching;

  const refresh = async () => {
    if (isBusy) return;
    setRefreshing(true);
    try {
      const settingsResult = await settingsQuery.refetch({
        cancelRefetch: false,
      });
      const status =
        settingsResult.data?.user?.settings?.googleHealth ||
        settingsResult.data?.googleHealthOAuth;
      if (!status?.connected) {
        toast.message("Connect Google Health to fetch data");
        return;
      }

      const data = await fetchHealthSummary();
      qc.setQueryData(["google-health-summary"], data);
      toast.success("Latest health data loaded");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn’t fetch latest health data"
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col px-3 py-14 md:px-6 md:py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Health</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              Google Health
              {snap?.date ? (
                <span className="text-foreground/70"> · {snap.date}</span>
              ) : null}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 rounded-lg"
            disabled={isBusy || !oauthAvailable}
            onClick={() => void refresh()}
          >
            {isBusy ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <div className="w-full md:h-[78vh] md:max-h-[720px] md:min-h-[480px]">
          {isLoading ? (
            <div className="grid h-full grid-cols-2 gap-3 md:grid-cols-12 md:grid-rows-2">
              <Skeleton className="col-span-2 rounded-[28px] md:col-span-7" />
              <Skeleton className="col-span-2 row-span-2 hidden rounded-[28px] md:col-span-5 md:block" />
              <Skeleton className="rounded-[28px] md:col-span-3" />
              <Skeleton className="rounded-[28px] md:col-span-4" />
            </div>
          ) : !oauthAvailable ? (
            <div
              className={cn(
                "flex h-full min-h-[280px] flex-col items-center justify-center rounded-[28px] px-6 py-10 text-center",
                panelBg
              )}
            >
              <GoogleHealthLogo size={52} />
              <p className="mt-5 text-sm font-medium">
                Google Health isn’t configured
              </p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Add GOOGLE_CLIENT_SECRET, enable the Google Health API, then
                reconnect.
              </p>
            </div>
          ) : !connected ? (
            <div
              className={cn(
                "flex h-full min-h-[280px] flex-col items-center justify-center rounded-[28px] px-6 py-10 text-center",
                panelBg
              )}
            >
              <GoogleHealthLogo size={52} />
              <p className="mt-5 text-sm font-medium">
                Connect your watch to see metrics
              </p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Authorize Google Health, then this dashboard fills in.
              </p>
              <Button asChild size="sm" className="mt-5 rounded-lg">
                <Link href="/integrations">Go to Integrations</Link>
              </Button>
            </div>
          ) : summaryQuery.isError ? (
            <div
              className={cn(
                "flex h-full min-h-[280px] flex-col items-center justify-center rounded-[28px] px-6 py-10 text-center",
                panelBg
              )}
            >
              <GoogleHealthLogo size={52} />
              <p className="mt-5 text-sm font-medium">
                Couldn’t load health data
              </p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                {summaryQuery.error instanceof Error
                  ? summaryQuery.error.message
                  : "Try refreshing, or reconnect Google Health."}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  disabled={isBusy}
                  onClick={() => void refresh()}
                >
                  {isBusy ? "Refreshing…" : "Try again"}
                </Button>
                <Button asChild size="sm" className="rounded-lg">
                  <Link href="/integrations">Integrations</Link>
                </Button>
              </div>
            </div>
          ) : snap ? (
            <HealthDashboard snap={snap} />
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
