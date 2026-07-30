"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { UiMessage } from "@/lib/api";
import {
  extractPdfFromContent,
  guessPdfFileName,
  resolvePdfHref,
  withDownloadParam,
} from "@/lib/pdf-export";
import { formatMessageMeta } from "@/lib/tool-label";
import { cn } from "@/lib/utils";
import { useChatUiStore } from "@/stores/app-store";
import { ChatMarkdown } from "@/components/chat/markdown";
import { SolvingIndicator } from "@/components/chat/solving-indicator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChatMessageProps {
  message: UiMessage;
  busy?: boolean;
  onEdit?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
}

function stripPdfDownloadLines(content: string): string {
  return content
    .replace(/\[(?:Download(?:\s+resume)?\s+PDF|[^\]]+\.pdf)\]\([^)]+\)/gi, "")
    .replace(/_Link expires in 24 hours\._/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "text-muted-foreground/70 transition-colors",
            "hover:bg-muted hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-40"
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function PdfFileCard({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}) {
  const openPdfViewer = useChatUiStore((s) => s.openPdfViewer);
  const pdfDoc = useChatUiStore((s) => s.pdfDoc);
  const pdfOpen = useChatUiStore((s) => s.pdfOpen);
  const active = pdfOpen && pdfDoc?.url === url;

  return (
    <div
      className={cn(
        "mt-1.5 flex w-full max-w-sm items-stretch overflow-hidden rounded-xl",
        "border border-border/70 bg-background shadow-sm",
        "dark:bg-neutral-900/80",
        active && "ring-1 ring-foreground/20"
      )}
    >
      <button
        type="button"
        onClick={() => openPdfViewer({ url, fileName })}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left",
          "transition-colors hover:bg-muted/60"
        )}
      >
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
            "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          )}
        >
          <FileTextIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {fileName}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            PDF · Click to preview
          </span>
        </span>
      </button>
      <a
        href={withDownloadParam(url)}
        download={fileName}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Download PDF"
        className={cn(
          "inline-flex shrink-0 items-center border-l border-border/60 px-3",
          "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DownloadIcon className="size-4" />
      </a>
    </div>
  );
}

export function ChatMessage({
  message,
  busy = false,
  onEdit,
  onRegenerate,
}: ChatMessageProps) {
  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const waiting =
    !isUser && Boolean(message.streaming) && !message.content?.trim();
  const assistantDone =
    !isUser && !message.streaming && Boolean(message.content?.trim());
  const userDone = isUser && Boolean(message.content?.trim());
  const isLong = Boolean(message.content && message.content.length > 480);
  const body = message.content?.trim() || "";
  const meta =
    !isUser && !message.streaming
      ? formatMessageMeta(message.intent, message.toolUsed)
      : "";
  const pdfUrl = !isUser
    ? resolvePdfHref(message.downloadUrl) ||
      (message.toolUsed === "resume-pdf" ||
      /\/api\/exports\/resume\//i.test(body)
        ? extractPdfFromContent(body)
        : null)
    : null;
  const pdfName = pdfUrl
    ? guessPdfFileName(message.fileName, body)
    : null;
  const displayBody = pdfUrl ? stripPdfDownloadLines(body) : body;

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      /* ignore */
    }
  };

  const copyBtn = (
    <ActionButton
      label={copied ? "Copied" : "Copy"}
      onClick={() => void copy()}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-emerald-500" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </ActionButton>
  );

  const editBtn = (
    <ActionButton
      label="Edit"
      disabled={busy}
      onClick={() => onEdit?.(message.id)}
    >
      <PencilIcon className="size-3.5" />
    </ActionButton>
  );

  return (
    <div
      className={cn(
        "group/msg flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1",
          isUser
            ? "max-w-[min(85%,28rem)] items-end"
            : "max-w-[min(100%,40rem)] items-start"
        )}
      >
        {isUser ? (
          <div
            className={cn(
              "w-fit max-w-full rounded-2xl rounded-br-md bg-blue-500 px-3.5 py-2.5",
              "text-[13.5px] leading-relaxed text-white shadow-sm",
              "whitespace-pre-wrap wrap-break-word"
            )}
          >
            {body}
          </div>
        ) : waiting ? (
          <SolvingIndicator />
        ) : (
          <div
            className={cn(
              "relative w-fit max-w-full overflow-hidden rounded-2xl rounded-bl-md",
              "bg-muted/70 px-3.5 py-2.5 shadow-sm",
              "dark:bg-neutral-800/90"
            )}
            style={{
              maxHeight: showFull || !isLong ? "none" : "11rem",
            }}
          >
            <ChatMarkdown content={displayBody} />
            {!showFull && isLong && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-muted/95 to-transparent dark:from-neutral-800" />
            )}
          </div>
        )}

        {pdfUrl && pdfName && assistantDone ? (
          <PdfFileCard url={pdfUrl} fileName={pdfName} />
        ) : null}

        {!isUser && !waiting && !showFull && isLong && (
          <button
            type="button"
            className="self-start text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowFull(true)}
          >
            Show more
          </button>
        )}

        {userDone && (
          <div
            className={cn(
              "flex items-center gap-0.5",
              "opacity-0 transition-opacity",
              "group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
            )}
          >
            {editBtn}
            {copyBtn}
          </div>
        )}

        {assistantDone && (
          <div className="flex flex-wrap items-center gap-0.5">
            {meta ? (
              <span
                className={cn(
                  "mr-0.5 inline-flex max-w-56 items-center truncate rounded-md px-1.5 py-0.5",
                  "text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase"
                )}
              >
                {meta}
              </span>
            ) : null}
            <ActionButton
              label="Regenerate"
              disabled={busy}
              onClick={() => onRegenerate?.(message.id)}
            >
              <RefreshCwIcon className="size-3.5" />
            </ActionButton>
            {copyBtn}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;
