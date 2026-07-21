/**
 * Fast-path chat: SSE streaming against Express /api/chat.
 * Tokens paint immediately — no waiting for a full JSON body.
 */
import { apiBaseUrl, getAccessToken } from "@/lib/api-base";

export async function streamChat(opts: {
  message: string;
  sessionId: string;
  history: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
  onToken: (chunk: string) => void;
  onDone: (meta: {
    intent?: string;
    reply?: string;
    toolUsed?: string | null;
  }) => void;
  onError: (err: string) => void;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-Requested-With": "XMLHttpRequest",
  };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBaseUrl()}/api/chat`, {
    method: "POST",
    credentials: "include",
    headers,
    signal: opts.signal,
    body: JSON.stringify({
      message: opts.message,
      sessionId: opts.sessionId,
      history: opts.history,
      stream: true,
    }),
  });

  if (res.status === 401) {
    opts.onError("Session expired — sign in again");
    return;
  }

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    opts.onError(
      (err as { error?: string }).error || `Request failed (${res.status})`
    );
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "token") opts.onToken(event.content);
        if (event.type === "done") opts.onDone(event);
        if (event.type === "error") opts.onError(event.error || "Stream error");
      } catch {
        /* skip partial JSON */
      }
    }
  }
}
