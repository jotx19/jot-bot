"use client";

import { useMemo, useState } from "react";
import type { UiMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CodeBlock, parseMessageParts } from "@/components/chat/code-block";

interface ChatMessageProps {
  message: UiMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [showFull, setShowFull] = useState(false);
  const isUser = message.role === "user";
  const isLong = Boolean(message.content && message.content.length > 480);

  const parts = useMemo(
    () => (isUser ? null : parseMessageParts(message.content || "")),
    [isUser, message.content]
  );

  const hasCode = Boolean(parts?.some((p) => p.type === "code"));
  const body =
    message.content?.trim() || (message.streaming ? "…" : "");

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1.5",
          isUser
            ? "max-w-[min(85%,28rem)] items-end"
            : hasCode
              ? "max-w-[min(100%,40rem)] items-stretch"
              : "max-w-[min(85%,36rem)] items-start"
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
        ) : hasCode && parts ? (
          <div className="flex w-full flex-col gap-2.5">
            {parts.map((part, i) =>
              part.type === "code" ? (
                <CodeBlock
                  key={`c-${i}`}
                  code={part.value}
                  language={part.language}
                  className="my-0"
                />
              ) : part.value.trim() ? (
                <div
                  key={`t-${i}`}
                  className={cn(
                    "w-fit max-w-full rounded-2xl rounded-bl-md",
                    "bg-muted/70 px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                    "text-foreground shadow-sm whitespace-pre-wrap wrap-break-word",
                    "dark:bg-neutral-800/90"
                  )}
                >
                  {part.value.trim()}
                </div>
              ) : null
            )}
          </div>
        ) : (
          <div
            className={cn(
              "relative w-fit max-w-full overflow-hidden rounded-2xl rounded-bl-md",
              "bg-muted/70 px-3.5 py-2.5 shadow-sm",
              "text-[13.5px] leading-relaxed text-foreground",
              "whitespace-pre-wrap wrap-break-word",
              "dark:bg-neutral-800/90"
            )}
            style={{
              maxHeight: showFull || !isLong ? "none" : "11rem",
            }}
          >
            {body}
            {!showFull && isLong && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-muted/95 to-transparent dark:from-neutral-800" />
            )}
          </div>
        )}

        {!isUser && !hasCode && !showFull && isLong && (
          <button
            type="button"
            className="self-start text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowFull(true)}
          >
            Show more
          </button>
        )}

        {message.intent &&
          message.role === "assistant" &&
          !message.streaming && (
            <span
              className={cn(
                "inline-flex w-fit items-center rounded-md px-1.5 py-0.5",
                "text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase"
              )}
            >
              {message.intent}
              {message.toolUsed ? ` · ${message.toolUsed}` : ""}
            </span>
          )}
      </div>
    </div>
  );
}

export default ChatMessage;
