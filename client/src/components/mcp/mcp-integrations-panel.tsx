"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { api, type McpServerPublic } from "@/lib/api";
import {
  draftToPayload,
  emptyMcpDraft,
  mcpConnectionLabel,
  publicMcpToDraft,
  type McpDraft,
} from "@/lib/mcp-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, panelBg } from "@/lib/utils";
import { toast } from "sonner";
import { useChatUiStore } from "@/stores/app-store";
import { GoogleHealthConnectCard } from "@/components/mcp/google-health-connect-card";

type McpIntegrationsPanelProps = {
  variant?: "page" | "settings";
  hint?: string;
};

type ToolCache = Record<string, { tools: string[]; loadedAt: number }>;

export function McpIntegrationsPanel({
  variant = "page",
  hint,
}: McpIntegrationsPanelProps) {
  const qc = useQueryClient();
  const isPage = variant === "page";
  const openSettings = useChatUiStore((s) => s.openSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings");
      return data;
    },
  });

  const [mcpServers, setMcpServers] = useState<McpDraft[]>([]);
  const [mcpDraft, setMcpDraft] = useState<McpDraft>(emptyMcpDraft);
  const [mcpTesting, setMcpTesting] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toolCache, setToolCache] = useState<ToolCache>({});

  useEffect(() => {
    const list = (data?.user?.settings?.mcpServers || []) as McpServerPublic[];
    setMcpServers(list.map(publicMcpToDraft));
  }, [data]);

  const saveMcp = useMutation({
    mutationFn: async (servers: McpDraft[]) => {
      const { data } = await api.put("/api/settings", {
        mcpServers: servers.map((s) => draftToPayload(s)),
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stats = useMemo(() => {
    const total = mcpServers.length;
    const enabled = mcpServers.filter((s) => s.enabled).length;
    const toolCount = Object.values(toolCache).reduce(
      (sum, entry) => sum + entry.tools.length,
      0
    );
    return { total, enabled, toolCount };
  }, [mcpServers, toolCache]);

  const persist = (next: McpDraft[], toastMsg?: string) => {
    setMcpServers(next);
    saveMcp.mutate(next, {
      onSuccess: () => {
        if (toastMsg) toast.success(toastMsg);
        else toast.success("Integrations saved");
      },
    });
  };

  const testServer = async (srv: McpDraft) => {
    setMcpTesting(srv.id);
    try {
      const { data: res } = await api.post<{ tools?: { name: string }[] }>(
        "/api/mcp/test",
        { id: srv.id }
      );
      const tools = (res.tools || []).map((t) => t.name);
      setToolCache((prev) => ({
        ...prev,
        [srv.id]: { tools, loadedAt: Date.now() },
      }));
      const preview = tools.slice(0, 6).join(", ");
      toast.success(
        `Connected — ${tools.length} tool(s)${preview ? `: ${preview}` : ""}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "MCP test failed");
    } finally {
      setMcpTesting(null);
    }
  };

  const cardClass = isPage
    ? cn("overflow-hidden rounded-2xl", panelBg)
    : "space-y-3 rounded-xl border border-white/10 bg-white/5 p-3";

  const addServer = () => {
    const payload = draftToPayload(mcpDraft);
    if (mcpDraft.transport === "stdio" && !String(payload.command || "").trim()) {
      toast.error("Command is required for stdio");
      return;
    }
    if (mcpDraft.transport !== "stdio" && !String(payload.url || "").trim()) {
      toast.error("URL is required");
      return;
    }
    if (mcpServers.length >= 8) {
      toast.error("Maximum 8 MCP servers");
      return;
    }
    const next = [
      ...mcpServers,
      {
        ...mcpDraft,
        id: String(payload.id),
        name: String(payload.name),
      },
    ];
    setMcpDraft(emptyMcpDraft());
    persist(next, `${payload.name} added`);
  };

  return (
    <div className={cn("space-y-6", !isPage && "pt-0")}>
      {!isPage && (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">MCP</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect Model Context Protocol servers. Tools appear in chat when a
            server is on (up to 8). The switch saves immediately.
          </p>
          {hint ? (
            <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      )}

      {isPage && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {isLoading ? (
            <>
              <div className={cn("rounded-2xl px-4 py-4", panelBg)}>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-9 w-12" />
              </div>
              <div className={cn("rounded-2xl px-4 py-4", panelBg)}>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-3 h-9 w-12" />
              </div>
            </>
          ) : (
            <>
              <div className={cn("rounded-2xl px-4 py-4", panelBg)}>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Connected
                </p>
                <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {stats.total}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stats.enabled
                    ? `${stats.enabled} enabled for chat`
                    : "None enabled"}
                </p>
              </div>
              <div className={cn("rounded-2xl px-4 py-4", panelBg)}>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Tools
                </p>
                <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {stats.toolCount || "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run Test on a server to count
                </p>
              </div>
            </>
          )}
        </div>
      )}

      <GoogleHealthConnectCard variant={variant} />

      <div
        className={cn(
          isPage ? "mt-6 space-y-2" : "space-y-3 border-t border-white/10 pt-5"
        )}
      >
        {isLoading ? (
          isPage ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : (
            <Skeleton className="h-24 rounded-xl" />
          )
        ) : !mcpServers.length ? (
          <div
            className={cn(
              isPage
                ? cn("rounded-2xl px-5 py-10 text-center", panelBg)
                : "text-sm text-muted-foreground"
            )}
          >
            <p className={cn(isPage && "text-sm font-medium")}>
              No integrations yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use Add more to connect Notion, filesystem, or other MCP servers.
            </p>
          </div>
        ) : isPage ? (
          <ul className="space-y-2">
            {mcpServers.map((srv, idx) => {
              const open = openId === srv.id;
              const tools = toolCache[srv.id]?.tools || [];
              return (
                <li key={srv.id || idx} className={cardClass}>
                  <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setOpenId(open ? null : srv.id)}
                    >
                      <ChevronDownIcon
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          open && "rotate-180"
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold">
                          {srv.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {srv.enabled ? (
                            <span className="text-emerald-500">Enabled</span>
                          ) : (
                            "Disabled"
                          )}
                          {" · "}
                          {srv.transport}
                          {" · "}
                          {mcpConnectionLabel(srv)}
                          {tools.length ? ` · ${tools.length} tools` : ""}
                        </p>
                      </div>
                    </button>
                    <Switch
                      checked={srv.enabled}
                      disabled={saveMcp.isPending}
                      onCheckedChange={(v) => {
                        const next = mcpServers.map((s, i) =>
                          i === idx ? { ...s, enabled: v } : s
                        );
                        persist(
                          next,
                          v
                            ? `${srv.name} enabled for chat`
                            : `${srv.name} disabled for chat`
                        );
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${srv.name}`}
                      onClick={() => {
                        const next = mcpServers.filter((_, i) => i !== idx);
                        persist(next, `${srv.name} removed`);
                        if (openId === srv.id) setOpenId(null);
                      }}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>

                  {open && (
                    <div className="space-y-3 border-t border-white/5 px-3 pb-4 pt-3 sm:px-4">
                      <div className="rounded-xl bg-black/20 px-3 py-2 font-mono text-xs text-muted-foreground">
                        <p>
                          <span className="text-foreground/70">transport</span>{" "}
                          {srv.transport}
                        </p>
                        {srv.transport === "stdio" ? (
                          <>
                            <p className="mt-1 break-all">
                              <span className="text-foreground/70">command</span>{" "}
                              {srv.command || "—"}
                            </p>
                            {srv.argsText ? (
                              <p className="mt-1 break-all">
                                <span className="text-foreground/70">args</span>{" "}
                                {srv.argsText}
                              </p>
                            ) : null}
                            {srv.envText.trim() ? (
                              <p className="mt-1 break-all">
                                <span className="text-foreground/70">env</span>{" "}
                                {srv.envText.replace(/=.*$/gm, "=•••")}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="mt-1 break-all">
                            <span className="text-foreground/70">url</span>{" "}
                            {srv.url || "—"}
                          </p>
                        )}
                      </div>

                      {tools.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Tools
                          </p>
                          <p className="font-mono text-xs leading-relaxed text-muted-foreground">
                            {tools.slice(0, 24).join(", ")}
                            {tools.length > 24 ? ` … +${tools.length - 24} more` : ""}
                          </p>
                        </div>
                      )}

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-lg text-xs"
                        disabled={mcpTesting === srv.id}
                        onClick={() => void testServer(srv)}
                      >
                        {mcpTesting === srv.id ? "Testing…" : "Test connection"}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          mcpServers.map((srv, idx) => (
            <div key={srv.id || idx} className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{srv.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {srv.transport} · {mcpConnectionLabel(srv)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={srv.enabled}
                    disabled={saveMcp.isPending}
                    onCheckedChange={(v) => {
                      const next = mcpServers.map((s, i) =>
                        i === idx ? { ...s, enabled: v } : s
                      );
                      persist(
                        next,
                        v
                          ? `${srv.name} enabled for chat`
                          : `${srv.name} disabled for chat`
                      );
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-red-300 hover:text-red-200"
                    onClick={() => {
                      const next = mcpServers.filter((_, i) => i !== idx);
                      persist(next, `${srv.name} removed`);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg text-xs"
                disabled={mcpTesting === srv.id}
                onClick={() => void testServer(srv)}
              >
                {mcpTesting === srv.id ? "Testing…" : "Test connection"}
              </Button>
            </div>
          ))
        )}
      </div>

      {isPage ? (
        <div className="flex justify-center pt-6">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg px-6"
            onClick={() => openSettings("mcp")}
          >
            Add more
          </Button>
        </div>
      ) : (
        <div className="space-y-3 border-t border-white/10 pt-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Add integration
          </p>
          <div className="space-y-2">
            <Label className="text-xs">Name</Label>
            <Input
              value={mcpDraft.name}
              onChange={(e) => setMcpDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="notion"
              className="h-9 rounded-lg bg-white/5 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Transport</Label>
            <div className="inline-flex w-full gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              {(["http", "sse", "stdio"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMcpDraft((d) => ({ ...d, transport: t }))}
                  className={cn(
                    "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                    mcpDraft.transport === t
                      ? "bg-white/10 text-white"
                      : "text-muted-foreground hover:bg-white/5"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {mcpDraft.transport === "stdio" ? (
            <>
              <div className="space-y-2">
                <Label className="text-xs">Command</Label>
                <Input
                  value={mcpDraft.command}
                  onChange={(e) =>
                    setMcpDraft((d) => ({ ...d, command: e.target.value }))
                  }
                  placeholder="npx"
                  className="h-9 rounded-lg bg-white/5 font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Args (space-separated)</Label>
                <Input
                  value={mcpDraft.argsText}
                  onChange={(e) =>
                    setMcpDraft((d) => ({ ...d, argsText: e.target.value }))
                  }
                  placeholder="-y @notionhq/notion-mcp-server"
                  className="h-9 rounded-lg bg-white/5 font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Env (KEY=value per line)</Label>
                <Textarea
                  value={mcpDraft.envText}
                  onChange={(e) =>
                    setMcpDraft((d) => ({ ...d, envText: e.target.value }))
                  }
                  placeholder="NOTION_TOKEN=ntn_…"
                  className="min-h-20 rounded-lg border-white/10 bg-white/5 font-mono text-xs"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="text-xs">Server URL</Label>
                <Input
                  value={mcpDraft.url}
                  onChange={(e) =>
                    setMcpDraft((d) => ({ ...d, url: e.target.value }))
                  }
                  placeholder="https://example.com/mcp"
                  className="h-9 rounded-lg bg-white/5 font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Headers (KEY=value per line)</Label>
                <Textarea
                  value={mcpDraft.headersText}
                  onChange={(e) =>
                    setMcpDraft((d) => ({ ...d, headersText: e.target.value }))
                  }
                  placeholder="Authorization=Bearer …"
                  className="min-h-20 rounded-lg border-white/10 bg-white/5 font-mono text-xs"
                />
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={addServer}
              disabled={saveMcp.isPending}
            >
              Add to list
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 rounded-lg"
              disabled={saveMcp.isPending || !mcpServers.length}
              onClick={() => persist(mcpServers)}
            >
              {saveMcp.isPending ? "Saving…" : "Save all"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
