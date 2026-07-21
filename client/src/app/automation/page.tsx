"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { api } from "@/lib/api";
import { CodeBlock } from "@/components/chat/code-block";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
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
  intervalMs: number | null;
  code: string;
  bytes: number;
  runCount?: number;
  failCount?: number;
  lastRunAt?: string | null;
  lastExitCode?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type SandboxStats = {
  scripts: number;
  scheduled: number;
  totalRuns: number;
  totalFails: number;
  lastRunAt: string | null;
};

function formatInterval(ms: number | null | undefined) {
  if (!ms || ms <= 0) return null;
  if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)}m`;
  return `every ${(ms / 3_600_000).toFixed(1).replace(/\.0$/, "")}h`;
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

export default function AutomationPage() {
  const qc = useQueryClient();
  const [openName, setOpenName] = useState<string | null>(null);
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

  const scripts = data?.scripts ?? [];
  const stats = data?.stats ?? {
    scripts: 0,
    scheduled: 0,
    totalRuns: 0,
    totalFails: 0,
    lastRunAt: null,
  };
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

  const sorted = useMemo(
    () =>
      [...scripts].sort((a, b) => {
        if (a.scheduled !== b.scheduled) return a.scheduled ? -1 : 1;
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      }),
    [scripts]
  );

  return (
    <AppShell>
      <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col px-3 py-14 md:px-6 md:py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Automation</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sandbox scripts saved from chat
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 sm:gap-3">
          <div className="rounded-2xl bg-muted/50 px-4 py-4 dark:bg-neutral-900/80">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Total runs
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">
              {isLoading ? "—" : stats.totalRuns}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.totalFails
                ? `${stats.totalFails} failed`
                : "Across all scripts"}
            </p>
          </div>
          <div className="rounded-2xl bg-muted/50 px-4 py-4 dark:bg-neutral-900/80">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Scripts
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums">
              {isLoading ? "—" : stats.scripts}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.scheduled
                ? `${stats.scheduled} scheduled`
                : stats.lastRunAt
                  ? `Last run ${formatUpdated(stats.lastRunAt)}`
                  : "None scheduled"}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-red-400">
            {(error as Error)?.message || "Failed to load scripts"}
          </p>
        ) : !sorted.length ? (
          <div className="rounded-2xl bg-muted/40 px-5 py-10 text-center">
            <p className="text-sm font-medium">No sandbox scripts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask the assistant to save a script in the sandbox, or schedule one
              with an interval.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {sorted.map((script) => {
              const open = openName === script.name;
              const interval = formatInterval(script.intervalMs);
              return (
                <li
                  key={script.name}
                  className="overflow-hidden rounded-2xl bg-muted/50 dark:bg-neutral-900/80"
                >
                  <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() =>
                        setOpenName(open ? null : script.name)
                      }
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
                          {script.scheduled ? (
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
