"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SearchIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  LibraryIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { DiscordIcon } from "@hugeicons/core-free-icons";
import { AppShell } from "@/components/app-shell";
import { GoogleHealthLogo } from "@/components/health/google-health-logo";
import { api } from "@/lib/api";
import { CodeBlock } from "@/components/chat/code-block";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, panelBg } from "@/lib/utils";
import { useChatUiStore } from "@/stores/app-store";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SandboxScript = {
  name: string;
  scheduled: boolean;
  paused: boolean;
  intervalMs: number | null;
  code: string;
  bytes: number;
  runCount?: number;
  failCount?: number;
  lastRunAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type SandboxStats = {
  scripts: number;
  scheduled: number;
  paused?: number;
  totalRuns: number;
  totalFails: number;
  lastRunAt: string | null;
};

type LibraryScript = {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  defaultIntervalMs: number | null;
  requires: string[];
};

const DEFAULT_LIBRARY_RAW_URL =
  "https://raw.githubusercontent.com/jotx19/tinyjot-automations/main";

function formatInterval(ms: number | null | undefined) {
  if (!ms || ms <= 0) return null;
  if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)}m`;
  return `every ${(ms / 3_600_000).toFixed(1).replace(/\.0$/, "")}h`;
}

function formatIntervalShort(ms: number | null | undefined) {
  if (!ms || ms <= 0) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1).replace(/\.0$/, "")}h`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatUpdated(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ScriptLogo({
  category,
  size = 48,
  className,
}: {
  category: string;
  size?: number;
  className?: string;
}) {
  const key = category.toLowerCase();
  if (key.includes("health")) {
    return (
      <GoogleHealthLogo
        size={size}
        className={cn("rounded-md", className)}
      />
    );
  }
  if (key.includes("discord")) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md bg-[#5865F2]",
          className
        )}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <HugeiconsIcon
          icon={DiscordIcon}
          size={Math.round(size * 0.52)}
          color="#fff"
        />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-white/10",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <LibraryIcon
        className="text-white/80"
        style={{ width: Math.round(size * 0.42), height: Math.round(size * 0.42) }}
      />
    </span>
  );
}

export default function AutomationPage() {
  const qc = useQueryClient();
  const openSettings = useChatUiStore((s) => s.openSettings);
  const [openName, setOpenName] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [copiedLibraryUrl, setCopiedLibraryUrl] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SandboxScript | null>(
    null
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["sandbox-scripts"],
    queryFn: async () => {
      const { data } = await api.get<{
        scripts: SandboxScript[];
        mongo?: boolean;
        stats?: SandboxStats;
      }>("/api/sandbox/scripts");
      return data;
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await api.get("/api/settings");
      return data;
    },
  });

  const libraryQuery = useQuery({
    queryKey: ["sandbox-library"],
    queryFn: async () => {
      const { data } = await api.get<{
        scripts: LibraryScript[];
        source?: string;
        connected?: boolean;
        remoteError?: string | null;
        libraryUrl?: string | null;
      }>("/api/sandbox/library");
      return data;
    },
  });

  const scripts = data?.scripts ?? [];
  const installedNames = useMemo(
    () => new Set(scripts.map((s) => s.name)),
    [scripts]
  );
  const stats = data?.stats ?? {
    scripts: 0,
    scheduled: 0,
    paused: 0,
    totalRuns: 0,
    totalFails: 0,
    lastRunAt: null,
  };
  const libraryUrl =
    settingsQuery.data?.user?.settings?.automationLibraryUrl || "";
  const libraryScripts = libraryQuery.data?.scripts ?? [];
  const libraryConnected = Boolean(
    libraryQuery.data?.connected && libraryUrl
  );
  const filteredLibrary = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return libraryScripts;
    return libraryScripts.filter((item) => {
      const haystack = [
        item.title,
        item.name,
        item.description,
        item.category,
        ...(Array.isArray(item.requires) ? item.requires : []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [libraryScripts, librarySearch]);

  const remove = useMutation({
    mutationFn: async (name: string) => {
      await api.delete(`/api/sandbox/scripts/${encodeURIComponent(name)}`);
    },
    onSuccess: () => {
      toast.success("Script deleted");
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["sandbox-scripts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const togglePause = useMutation({
    mutationFn: async ({
      name,
      paused,
    }: {
      name: string;
      paused: boolean;
    }) => {
      const path = paused
        ? `/api/sandbox/scripts/${encodeURIComponent(name)}/resume`
        : `/api/sandbox/scripts/${encodeURIComponent(name)}/pause`;
      await api.post(path);
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.paused ? "Script resumed" : "Script paused");
      qc.invalidateQueries({ queryKey: ["sandbox-scripts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const install = useMutation({
    mutationFn: async ({
      id,
      schedule,
      intervalMs,
    }: {
      id: string;
      schedule: boolean;
      intervalMs: number | null;
    }) => {
      const { data } = await api.post<{
        installed: boolean;
        name: string;
        scheduled: boolean;
      }>(`/api/sandbox/library/${encodeURIComponent(id)}/install`, {
        schedule,
        intervalMs,
      });
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        data.scheduled
          ? `Installed & scheduled ${data.name}`
          : `Installed ${data.name}`
      );
      qc.invalidateQueries({ queryKey: ["sandbox-scripts"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const connectLibrary = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{
        refreshed: boolean;
        connected: boolean;
        remoteError?: string | null;
        count: number;
      }>("/api/sandbox/library/refresh");
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["sandbox-library"] });
      if (data.connected) {
        toast.success(`Connected — ${data.count} scripts available`);
      } else if (data.remoteError) {
        toast.error(data.remoteError);
      } else {
        toast.message("Add a library repo URL in Settings → Automation");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sorted = useMemo(
    () =>
      [...scripts].sort((a, b) => {
        const aActive = a.scheduled && !a.paused;
        const bActive = b.scheduled && !b.paused;
        if (aActive !== bActive) return aActive ? -1 : 1;
        if (a.paused !== b.paused) return a.paused ? -1 : 1;
        return String(b.updatedAt || "").localeCompare(
          String(a.updatedAt || "")
        );
      }),
    [scripts]
  );

  const handleConnect = () => {
    if (!libraryUrl.trim()) {
      openSettings("automation");
      toast.message("Add your automation library URL, then Connect");
      return;
    }
    connectLibrary.mutate();
  };

  const copyLibraryUrl = async () => {
    try {
      await navigator.clipboard.writeText(DEFAULT_LIBRARY_RAW_URL);
      setCopiedLibraryUrl(true);
      toast.success("Library URL copied");
      openSettings("automation");
      window.setTimeout(() => setCopiedLibraryUrl(false), 1600);
    } catch {
      toast.error("Could not copy");
      openSettings("automation");
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col px-3 py-14 md:px-6 md:py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Automation</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your sandbox scripts and the script library
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={isFetching}
            onClick={() => {
              void refetch();
              void libraryQuery.refetch();
            }}
          >
            {isFetching || libraryQuery.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 sm:gap-3">
          {isLoading ? (
            <>
              <div className={cn("rounded-2xl px-4 py-4", panelBg)}>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-9 w-16" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
              <div className={cn("rounded-2xl px-4 py-4", panelBg)}>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-3 h-9 w-12" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
            </>
          ) : (
            <>
              <div className={cn("rounded-2xl px-4 py-4", panelBg)}>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Total runs
                </p>
                <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {stats.totalRuns}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stats.totalFails
                    ? `${stats.totalFails} failed`
                    : "Across all scripts"}
                </p>
              </div>
              <div className={cn("rounded-2xl px-4 py-4", panelBg)}>
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Scripts
                </p>
                <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {stats.scripts}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stats.scheduled
                    ? `${stats.scheduled} running`
                    : stats.paused
                      ? `${stats.paused} paused`
                      : stats.lastRunAt
                        ? `Last run ${formatUpdated(stats.lastRunAt)}`
                        : "None scheduled"}
                  {stats.scheduled && stats.paused
                    ? ` · ${stats.paused} paused`
                    : ""}
                </p>
              </div>
            </>
          )}
        </div>

        {/* My scripts */}
        {isLoading ? (
          <div className="mb-6 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <p className="mb-6 text-sm text-red-400">
            {(error as Error)?.message || "Failed to load scripts"}
          </p>
        ) : !sorted.length ? (
          <div
            className={cn("mb-6 rounded-2xl px-5 py-8 text-center", panelBg)}
          >
            <p className="text-sm font-medium">No sandbox scripts yet</p>
            <p className="mb-6 text-xs text-muted-foreground">
              Paste a library URL in Settings Automation, Connect, then Get a
              script.
            </p>
            <div className="mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-left">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-foreground">
                  {DEFAULT_LIBRARY_RAW_URL}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                onClick={() => void copyLibraryUrl()}
              >
                {copiedLibraryUrl ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <CopyIcon className="size-3.5" />
                )}
                {copiedLibraryUrl ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : (
          <ul className="mb-6 space-y-2">
            {sorted.map((script) => {
              const open = openName === script.name;
              const interval = formatInterval(script.intervalMs);
              const canToggle =
                Boolean(script.intervalMs) &&
                (script.scheduled || script.paused);
              const toggling =
                togglePause.isPending &&
                togglePause.variables?.name === script.name;
              return (
                <li
                  key={script.name}
                  className={cn("overflow-hidden rounded-2xl", panelBg)}
                >
                  <div className="flex items-center gap-1 px-3 py-3 sm:gap-2 sm:px-4">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setOpenName(open ? null : script.name)}
                    >
                      <ChevronDownIcon
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          open && "rotate-180"
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold">
                          {script.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {script.paused ? (
                            <span className="text-amber-500">
                              Paused{interval ? ` · ${interval}` : ""}
                            </span>
                          ) : script.scheduled ? (
                            <span className="text-emerald-500">
                              Scheduled{interval ? ` · ${interval}` : ""}
                            </span>
                          ) : (
                            "Saved"
                          )}
                          {" · "}
                          {script.runCount || 0} run
                          {(script.runCount || 0) === 1 ? "" : "s"}
                          {" · "}
                          {formatBytes(script.bytes)}
                          {script.lastRunAt
                            ? ` · last ${formatUpdated(script.lastRunAt)}`
                            : ""}
                        </p>
                      </div>
                    </button>
                    {canToggle && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={
                          script.paused
                            ? `Resume ${script.name}`
                            : `Pause ${script.name}`
                        }
                        disabled={toggling}
                        onClick={() =>
                          togglePause.mutate({
                            name: script.name,
                            paused: script.paused,
                          })
                        }
                      >
                        {script.paused ? (
                          <PlayIcon className="size-4" />
                        ) : (
                          <PauseIcon className="size-4" />
                        )}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${script.name}`}
                      onClick={() => setPendingDelete(script)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>

                  {open && (
                    <div className="border-t border-white/5 px-3 pb-3 pt-2 sm:px-4">
                      <CodeBlock
                        code={script.code || "// empty"}
                        language="javascript"
                        className="my-0"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Script library */}
        <div className="mt-2">
          <div className="flex flex-nowrap items-center gap-2 px-0.5 sm:gap-2.5">
            <p className="shrink-0 text-sm font-medium tracking-tight uppercase">
              Library
            </p>
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none sm:gap-2.5">
              <div className="relative z-10 min-w-0 flex-1 sm:w-64 sm:flex-none sm:max-w-[16rem]">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="library-search"
                  type="search"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-8 w-full rounded-lg border border-border/60 bg-transparent pr-2.5 pl-8 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-border"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={
                  connectLibrary.isPending
                    ? "Connecting"
                    : libraryConnected
                      ? "Connected — reconnect library"
                      : "Connect library"
                }
                title={
                  libraryConnected
                    ? "Connected"
                    : connectLibrary.isPending
                      ? "Connecting…"
                      : "Connect"
                }
                className={cn(
                  "size-8 shrink-0 rounded-lg p-0 sm:h-8 sm:w-auto sm:px-3 sm:text-xs",
                  libraryConnected &&
                    "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300"
                )}
                disabled={connectLibrary.isPending}
                onClick={handleConnect}
              >
                <LinkIcon className="size-3.5" />
                <span className="hidden sm:inline">
                  {connectLibrary.isPending
                    ? "Connecting…"
                    : libraryConnected
                      ? "Connected"
                      : "Connect"}
                </span>
              </Button>
            </div>
          </div>
          {libraryQuery.data?.remoteError ? (
            <p className="mt-1.5 text-xs text-amber-500">
              {libraryQuery.data.remoteError}
            </p>
          ) : null}

          <div className="mt-2">
            {libraryQuery.isLoading && !libraryScripts.length ? (
              <div className="divide-y divide-border/50">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5">
                    <Skeleton className="size-10 shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-1/2" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : libraryQuery.isError ? (
              <p className="py-4 text-sm text-red-400">
                {(libraryQuery.error as Error)?.message ||
                  "Failed to load library"}
              </p>
            ) : !filteredLibrary.length ? (
              <p className="py-18 text-center text-xs text-muted-foreground">
                {libraryScripts.length
                  ? `No matches for “${librarySearch.trim()}”.`
                  : libraryConnected
                    ? "Repo connected, but catalog has no scripts."
                    : libraryUrl
                      ? "Could not load the repo. Check the URL, then Connect."
                      : "Connect a library repo in Settings"}
              </p>
            ) : (
              <ul
                className={cn(
                  "divide-y divide-border/50",
                  filteredLibrary.length > 5 &&
                    "max-h-[22.5rem] overflow-y-auto overscroll-contain pr-1"
                )}
              >
                {filteredLibrary.map((item) => {
                  const installed = installedNames.has(item.name);
                  const installing =
                    install.isPending && install.variables?.id === item.id;
                  const intervalShort = formatIntervalShort(
                    item.defaultIntervalMs
                  );
                  const meta = [
                    item.name,
                    intervalShort ? `every ${intervalShort}` : null,
                    item.category || null,
                    installed ? "Installed" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <li
                      key={item.id}
                      className="group flex items-center gap-3 py-2.5"
                    >
                      <ScriptLogo
                        category={item.category}
                        size={40}
                        className="shrink-0 rounded-md"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium tracking-tight text-foreground">
                          {item.title}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {item.description}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/75">
                          {meta}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                        disabled={installing}
                        onClick={() =>
                          install.mutate({
                            id: item.id,
                            schedule: Boolean(item.defaultIntervalMs),
                            intervalMs: item.defaultIntervalMs,
                          })
                        }
                      >
                        {installed ? (
                          <>
                            <CheckIcon className="size-3.5" />
                            Reinstall
                          </>
                        ) : (
                          <>
                            <PlusIcon className="size-3.5" />
                            Get
                          </>
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-sm gap-4 rounded-2xl p-5 sm:max-w-sm"
        >
          <DialogHeader>
            <DialogTitle>Delete script?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" will be removed from the sandbox.`
                : "This script will be removed."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl"
              disabled={remove.isPending}
              onClick={() => {
                if (pendingDelete) remove.mutate(pendingDelete.name);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
