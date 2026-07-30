/**
 * Shared helpers for resume / export PDF URLs in the chat UI.
 */

import { apiBaseUrl } from "@/lib/api-base";

export function resolvePdfHref(url?: string | null): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${apiBaseUrl()}${raw}`;
  return raw;
}

/** Force Content-Disposition: attachment on the API export route. */
export function withDownloadParam(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("download", "1");
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}download=1`;
  }
}

export function extractPdfFromContent(content: string): string | null {
  const md = content.match(
    /\[(?:Download(?:\s+resume)?\s+PDF|resume\.pdf|[^\]]+\.pdf)\]\(([^)\s]+)\)/i
  );
  if (md?.[1]) return resolvePdfHref(md[1]);
  const path = content.match(/\/api\/exports\/resume\/[a-f0-9]+/i);
  if (path?.[0]) return resolvePdfHref(path[0]);
  return null;
}

export function guessPdfFileName(
  fileName?: string | null,
  content?: string
): string {
  if (fileName?.trim()) return fileName.trim();
  const fromLink = content?.match(/\/([A-Za-z0-9._-]+\.pdf)\b/i);
  if (fromLink?.[1]) return fromLink[1];
  return "resume.pdf";
}
