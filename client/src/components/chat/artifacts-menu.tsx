"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DownloadIcon,
  FileTextIcon,
  LayersIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { resolvePdfHref, withDownloadParam } from "@/lib/pdf-export";
import { useChatUiStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ArtifactItem = {
  id: string;
  fileName: string;
  createdAt: number;
  size: number;
  url: string;
  downloadUrl?: string;
};

function formatBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAge(ts: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ArtifactsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [items, setItems] = useState<ArtifactItem[]>([]);
  const openPdfViewer = useChatUiStore((s) => s.openPdfViewer);
  const closePdfViewer = useChatUiStore((s) => s.closePdfViewer);
  const pdfDoc = useChatUiStore((s) => s.pdfDoc);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ artifacts: ArtifactItem[] }>(
        "/api/artifacts"
      );
      setItems(data.artifacts || []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load artifacts"
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const previewUrl = (item: ArtifactItem) =>
    resolvePdfHref(item.downloadUrl || item.url);

  const openItem = (item: ArtifactItem) => {
    const url = previewUrl(item);
    if (!url) return;
    openPdfViewer({ url, fileName: item.fileName });
    setOpen(false);
  };

  const removeOne = async (item: ArtifactItem) => {
    try {
      await api.delete(`/api/artifacts/${item.id}`);
      setItems((prev) => prev.filter((a) => a.id !== item.id));
      if (pdfDoc?.url?.includes(item.id)) closePdfViewer();
      toast.success("Artifact deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const clearAll = async () => {
    if (!items.length) return;
    setClearing(true);
    try {
      const { data } = await api.delete<{ deleted?: number }>("/api/artifacts");
      setItems([]);
      if (pdfDoc?.url?.includes("/api/exports/resume/")) closePdfViewer();
      toast.success(
        data.deleted
          ? `Cleared ${data.deleted} artifact(s)`
          : "Artifacts cleared"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Artifacts"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={cn(
              "relative inline-flex size-7 md:size-8 items-center justify-center rounded-lg",
              "border border-white/10 bg-black/45 text-foreground/85",
              "shadow-sm backdrop-blur-xl transition-colors",
              "hover:bg-black/60 hover:text-foreground",
              "supports-backdrop-filter:bg-black/35",
              open &&
                "border border-white/10 bg-black/50 text-foreground/90 bg-linear-to-br from-sky-500/10 via-transparent to-transparent md:bg-black/45 md:shadow-sm md:backdrop-blur-xl md:supports-backdrop-filter:bg-black/35",
              className
            )}
          >
            <LayersIcon className="size-3 md:size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Artifacts</TooltipContent>
      </Tooltip>

      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 backdrop-blur-xl"
        className={cn(
          "flex !flex-col gap-0 overflow-hidden p-0 text-white shadow-2xl",
          "fixed inset-x-0 bottom-0 top-auto h-[min(92dvh,720px)] max-h-[92dvh] w-full max-w-none",
          "translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none",
          "border-white/8 bg-[#171717] ring-1 ring-white/6",
          "sm:inset-auto sm:top-[50%] sm:left-[50%] sm:h-[min(640px,85vh)] sm:max-h-[85vh]",
          "sm:w-full sm:max-w-[860px] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl"
        )}
      >
        <DialogHeader className="shrink-0 space-y-0 px-5 pb-3 pt-5 text-left sm:px-6 sm:pt-6">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-[15px] font-medium tracking-tight text-white">
              Artifacts
            </DialogTitle>
            <div className="flex items-center gap-1">
              {items.length > 0 && !loading ? (
                <button
                  type="button"
                  disabled={clearing}
                  onClick={() => void clearAll()}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium tracking-wide",
                    "text-white/45 transition-colors",
                    "hover:text-white",
                    "disabled:pointer-events-none disabled:opacity-40"
                  )}
                >
                  {clearing ? "Clearing…" : "Clear"}
                </button>
              ) : null}
              <DialogClose
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-md",
                  "text-white/45 transition-colors",
                  "hover:bg-white/5 hover:text-white",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                )}
              >
                <XIcon className="size-3.5" />
                <span className="sr-only">Close</span>
              </DialogClose>
            </div>
          </div>
          <DialogDescription className="mt-1 text-[12px] leading-relaxed text-white/40">
            Temporary resume PDFs.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4 sm:pb-4">
          {loading ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl">
              <ul className="space-y-1 p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-lg px-2.5 py-2.5"
                  >
                    <Skeleton className="size-3.5 shrink-0 rounded-sm bg-white/10" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-[55%] bg-white/10" />
                      <Skeleton className="h-2.5 w-[28%] bg-white/8" />
                    </div>
                    <Skeleton className="size-7 shrink-0 rounded-md bg-white/8" />
                    <Skeleton className="size-7 shrink-0 rounded-md bg-white/8" />
                  </li>
                ))}
              </ul>
            </div>
          ) : items.length === 0 ? (
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 px-6 text-center",
                "rounded-xl border border-dashed border-white"
              )}
            >
              <FileTextIcon className="size-10 text-white/25" />
              <div className="space-y-1">
                <p className="text-[13px] font-medium text-white/55">
                  Nothing here yet
                </p>
                <p className="text-[12px] leading-relaxed text-white/30">
                  Resume PDFs you generate in chat will show up here.
                </p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl">
              <ul className="divide-y divide-white/5 p-1">
                {items.map((item) => (
                  <li key={item.id}>
                    <div
                      className={cn(
                        "group flex items-center gap-0.5 rounded-lg",
                        "transition-colors hover:bg-white/[0.04]"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2.5 text-left"
                      >
                        <FileTextIcon className="size-3.5 shrink-0 text-white/35" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium tracking-tight text-white/90">
                            {item.fileName}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-white/35">
                            {formatBytes(item.size)} · {formatAge(item.createdAt)}
                          </span>
                        </span>
                      </button>
                      <div
                        className={cn(
                          "mr-1 flex shrink-0 items-center gap-0.5",
                          "opacity-0 transition-opacity",
                          "group-hover:opacity-100 group-focus-within:opacity-100"
                        )}
                      >
                        <a
                          href={withDownloadParam(previewUrl(item) || item.url)}
                          download={item.fileName}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Download ${item.fileName}`}
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-md",
                            "text-white/45 transition-colors",
                            "hover:bg-white/5 hover:text-white"
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DownloadIcon className="size-3.5" />
                        </a>
                        <button
                          type="button"
                          aria-label={`Delete ${item.fileName}`}
                          onClick={() => void removeOne(item)}
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-md",
                            "text-white/45 transition-colors",
                            "hover:bg-white/5 hover:text-white"
                          )}
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
