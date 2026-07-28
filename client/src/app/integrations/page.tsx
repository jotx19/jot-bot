"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { McpIntegrationsPanel } from "@/components/mcp/mcp-integrations-panel";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function IntegrationsPage() {
  const { isFetching, refetch } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings");
      return data;
    },
  });

  return (
    <AppShell>
      <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col px-3 py-14 md:px-6 md:py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Google Health (Fitbit / Pixel Watch) and MCP servers — Notion,
              filesystem, and more
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 rounded-lg sm:w-auto"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <McpIntegrationsPanel variant="page" />
      </div>
    </AppShell>
  );
}
