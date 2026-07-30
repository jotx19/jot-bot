"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DownloadIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
} from "lucide-react";
import { useChatUiStore } from "@/stores/app-store";
import { withDownloadParam } from "@/lib/pdf-export";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

function HeaderBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg",
            "text-muted-foreground transition-colors",
            "hover:bg-muted hover:text-foreground"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function PdfViewerChrome({
  fileName,
  url,
  expanded,
  onToggleExpand,
  onClose,
  className,
}: {
  fileName: string;
  url: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  className?: string;
}) {
  const downloadHref = withDownloadParam(url);

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <header
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 border-b border-border/60",
          "bg-background/95 px-3 backdrop-blur-sm"
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {fileName}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">PDF</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <HeaderBtn
            label="Download"
            onClick={() => {
              const a = document.createElement("a");
              a.href = downloadHref;
              a.download = fileName;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.click();
            }}
          >
            <DownloadIcon className="size-4" />
          </HeaderBtn>
          <HeaderBtn
            label={expanded ? "Exit full width" : "Expand"}
            onClick={onToggleExpand}
          >
            {expanded ? (
              <Minimize2Icon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
          </HeaderBtn>
          <HeaderBtn label="Close" onClick={onClose}>
            <XIcon className="size-4" />
          </HeaderBtn>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-neutral-200/80 dark:bg-neutral-900">
        <iframe
          key={url}
          title={fileName}
          src={`${url}#toolbar=1&navpanes=0`}
          className="absolute inset-0 size-full border-0 bg-neutral-200 dark:bg-neutral-900"
        />
      </div>
    </div>
  );
}

function ResizeHandle({ onDrag }: { onDrag: (clientX: number) => void }) {
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      onDrag(e.clientX);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onDrag]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize PDF panel"
      onPointerDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      className={cn(
        "group relative z-20 w-3 shrink-0 cursor-col-resize",
        "bg-transparent"
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
          "bg-border/80 transition-colors group-hover:bg-foreground/30",
          "group-active:bg-foreground/40"
        )}
      />
      <div
        className={cn(
          "absolute left-1/2 top-1/2 flex h-8 w-3.5 -translate-x-1/2 -translate-y-1/2",
          "items-center justify-center rounded-full border border-border/70",
          "bg-background shadow-sm",
          "opacity-70 transition-opacity group-hover:opacity-100"
        )}
      >
        <span className="h-3.5 w-0.5 rounded-full bg-muted-foreground/50" />
      </div>
    </div>
  );
}

/**
 * Right-side (or mobile overlay) PDF preview with resize + download.
 * Render as a sibling of the chat column inside a flex row.
 */
export function PdfViewerPanel({
  splitRef,
}: {
  splitRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isMobile = useIsMobile();
  const pdfOpen = useChatUiStore((s) => s.pdfOpen);
  const pdfDoc = useChatUiStore((s) => s.pdfDoc);
  const pdfExpanded = useChatUiStore((s) => s.pdfExpanded);
  const pdfWidthPct = useChatUiStore((s) => s.pdfWidthPct);
  const closePdfViewer = useChatUiStore((s) => s.closePdfViewer);
  const togglePdfExpanded = useChatUiStore((s) => s.togglePdfExpanded);
  const setPdfWidthPct = useChatUiStore((s) => s.setPdfWidthPct);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const onDrag = useCallback(
    (clientX: number) => {
      const el = splitRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40) return;
      const fromRight = ((rect.right - clientX) / rect.width) * 100;
      setPdfWidthPct(fromRight);
    },
    [setPdfWidthPct, splitRef]
  );

  useEffect(() => {
    if (!pdfOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePdfViewer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pdfOpen, closePdfViewer]);

  if (!mounted || !pdfOpen || !pdfDoc) return null;

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <PdfViewerChrome
          fileName={pdfDoc.fileName}
          url={pdfDoc.url}
          expanded
          onToggleExpand={closePdfViewer}
          onClose={closePdfViewer}
        />
      </div>
    );
  }

  const width = pdfExpanded ? "min(92vw, 100%)" : `${pdfWidthPct}%`;

  return (
    <>
      {!pdfExpanded ? <ResizeHandle onDrag={onDrag} /> : null}
      <aside
        className={cn(
          "flex h-svh shrink-0 flex-col border-l border-border/60",
          "sticky top-0 self-start bg-background",
          pdfExpanded && "fixed inset-y-0 right-0 z-40 shadow-2xl"
        )}
        style={{ width, maxWidth: pdfExpanded ? "100%" : undefined }}
      >
        <PdfViewerChrome
          fileName={pdfDoc.fileName}
          url={pdfDoc.url}
          expanded={pdfExpanded}
          onToggleExpand={togglePdfExpanded}
          onClose={closePdfViewer}
          className="h-full"
        />
      </aside>
    </>
  );
}
