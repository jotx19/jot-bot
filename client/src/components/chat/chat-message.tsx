"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { UiMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
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
      ? [message.intent, message.toolUsed].filter(Boolean).join(" · ")
      : "";

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
            <ChatMarkdown content={body} />
            {!showFull && isLong && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-muted/95 to-transparent dark:from-neutral-800" />
            )}
          </div>
        )}

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
                  "mr-0.5 inline-flex max-w-[14rem] items-center truncate rounded-md px-1.5 py-0.5",
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
