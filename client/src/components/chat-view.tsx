"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareIcon } from "lucide-react";
import { api, type UiMessage } from "@/lib/api";
import { streamChat } from "@/lib/stream-chat";
import { useChatUiStore } from "@/stores/app-store";
import { ChatMessage } from "@/components/chat/chat-message";
import { ChatMessageInput } from "@/components/chat/chat-message-input";
import { EmptyChat } from "@/components/chat/empty-chat";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0h 0m 0s";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  return `${h}h ${m}m ${s}s`;
}

/** Shorter timer for narrow screens. */
function formatRemainingCompact(ms: number): string {
  if (ms <= 0) return "0m";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function useCountdown(expiresAt: string | Date | null | undefined) {
  const target = useMemo(() => {
    if (!expiresAt) return null;
    const t = new Date(expiresAt).getTime();
    return Number.isFinite(t) ? t : null;
  }, [expiresAt]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (!target) return null;
  return Math.max(0, target - now);
}

export function ChatView() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const qc = useQueryClient();
  const setActiveSessionId = useChatUiStore((s) => s.setActiveSessionId);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setActiveSessionId(sessionId);
  }, [sessionId, setActiveSessionId]);

  const { data: sessionData, isLoading } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data } = await api.get<{
        messages: Array<{ role: string; content: string; intent?: string }>;
        expiresAt?: string | null;
        updatedAt?: string | null;
        retentionDays?: number;
      }>(`/api/session/${sessionId}`);
      return data;
    },
    enabled: Boolean(sessionId),
  });

  useEffect(() => {
    if (!sessionData?.messages) return;
    setMessages(
      sessionData.messages.map((m, i) => ({
        id: `r-${i}`,
        role: m.role as "user" | "assistant",
        content: m.content,
        intent: m.intent || null,
      }))
    );
  }, [sessionData]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const [fallbackExpiry, setFallbackExpiry] = useState<string | null>(null);

  useEffect(() => {
    setFallbackExpiry(null);
  }, [sessionId]);

  useEffect(() => {
    if (sessionData?.expiresAt) {
      setFallbackExpiry(null);
      return;
    }
    if (!sessionData || fallbackExpiry) return;
    const days = sessionData.retentionDays ?? 7;
    setFallbackExpiry(
      new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    );
  }, [sessionData, fallbackExpiry]);

  const displayRemainingMs = useCountdown(
    sessionData?.expiresAt || fallbackExpiry
  );
  const empty = !messages.length && !isLoading;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    setError(null);
    setInput("");
    setBusy(true);

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);

    const history = [...messages, userMsg]
      .filter((m) => m.content && !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      await streamChat({
        message: text,
        sessionId,
        history,
        signal: abortRef.current.signal,
        onToken: (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + chunk, streaming: true }
                : m
            )
          );
        },
        onDone: (meta) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: meta.reply || m.content,
                    intent: meta.intent || null,
                    toolUsed: meta.toolUsed ?? null,
                    streaming: false,
                  }
                : m
            )
          );
          qc.invalidateQueries({ queryKey: ["sessions"] });
          qc.invalidateQueries({ queryKey: ["session", sessionId] });
        },
        onError: (err) => {
          setError(err);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content || `Error: ${err}`,
                    streaming: false,
                  }
                : m
            )
          );
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh w-full justify-center">
      <div className="flex w-full max-w-4xl flex-col px-3 md:px-4">
        <div className="sticky top-0 z-40 pb-2 pt-3 pl-12 pr-1 md:px-1 md:pt-4">
          {/* Mobile: compact single bar */}
          <div
            className={cn(
              "mt-1 flex h-10 w-full min-w-0 items-center gap-1.5 rounded-2xl md:hidden",
              "border border-white/10 bg-black/40 px-2",
              "shadow-sm backdrop-blur-xl supports-backdrop-filter:bg-black/30"
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <div className="inline-flex shrink-0 items-center gap-1.5 px-1">
                <MessageSquareIcon className="size-3.5 shrink-0 text-foreground/80" />
                <span className="text-xs font-semibold tracking-tight text-foreground">
                  Chat
                </span>
              </div>
              <span aria-hidden className="h-3.5 w-px shrink-0 bg-white/20" />
              <span className="min-w-0 truncate px-1 text-[11px] text-muted-foreground">
                Live
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center rounded-lg",
                    "border border-white/10 bg-black/50 px-2",
                    "bg-linear-to-br from-sky-500/10 via-transparent to-transparent"
                  )}
                >
                  <span className="font-mono text-[10px] tabular-nums leading-none tracking-tight text-foreground/90">
                    {displayRemainingMs != null
                      ? formatRemainingCompact(displayRemainingMs)
                      : "…"}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sessionData?.expiresAt
                  ? "Time left before this chat is auto-deleted"
                  : `Chats are kept for ${sessionData?.retentionDays ?? 7} days`}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Desktop: separate pills */}
          <div className="hidden items-center justify-between gap-3 md:flex">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full",
                  "border border-white/10 bg-black/40 px-3",
                  "shadow-sm backdrop-blur-xl supports-backdrop-filter:bg-black/30"
                )}
              >
                <MessageSquareIcon className="size-3.5 shrink-0 text-foreground/80" />
                <span className="text-xs font-semibold tracking-tight text-foreground">
                  Chat
                </span>
              </div>

              <span
                aria-hidden
                className="h-4 w-px shrink-0 bg-white/20"
              />

              <div
                className={cn(
                  "inline-flex h-9 items-center rounded-full",
                  "border border-white/10 bg-black/40 px-3",
                  "shadow-sm backdrop-blur-xl supports-backdrop-filter:bg-black/30"
                )}
              >
                <span className="text-xs text-muted-foreground">
                  Streaming · low latency
                </span>
              </div>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center rounded-xl",
                    "border border-white/10 bg-black/45 px-3",
                    "shadow-sm backdrop-blur-xl supports-backdrop-filter:bg-black/35",
                    "bg-linear-to-br from-sky-500/10 via-transparent to-transparent"
                  )}
                >
                  <span className="font-mono text-xs tabular-nums leading-none tracking-tight text-foreground/90">
                    {displayRemainingMs != null
                      ? formatRemaining(displayRemainingMs)
                      : "…"}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sessionData?.expiresAt
                  ? "Time left before this chat is auto-deleted"
                  : `Chats are kept for ${sessionData?.retentionDays ?? 7} days`}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div
          className={
            empty
              ? "flex flex-1 items-center justify-center"
              : "flex-1 space-y-4 overflow-y-auto px-1 py-4 pb-24"
          }
        >
          {isLoading && (
            <p className="text-center text-sm text-muted-foreground">
              Restoring…
            </p>
          )}
          {empty && (
            <EmptyChat
              title="No chat yet"
              description="Send a message to start — or pick a session from the sidebar."
            />
          )}
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="mb-2 px-1 text-sm text-red-400">{error}</div>
        )}

        <div className="sticky bottom-0 z-40 backdrop-blur">
          <ChatMessageInput
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            disabled={busy}
          />
        </div>
      </div>
    </div>
  );
}
