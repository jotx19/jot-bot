import type { McpServerPublic } from "@/lib/api";

export type McpDraft = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http" | "sse";
  command: string;
  argsText: string;
  cwd: string;
  url: string;
  envText: string;
  headersText: string;
};

export function emptyMcpDraft(): McpDraft {
  return {
    id: "",
    name: "",
    enabled: true,
    transport: "http",
    command: "",
    argsText: "",
    cwd: "",
    url: "",
    envText: "",
    headersText: "",
  };
}

export function parseKvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function draftToPayload(d: McpDraft) {
  const id =
    d.id ||
    d.name
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 32) ||
    `mcp_${Date.now().toString(36)}`;
  const base: Record<string, unknown> = {
    id,
    name: d.name.trim() || id,
    enabled: d.enabled,
    transport: d.transport,
  };
  if (d.transport === "stdio") {
    base.command = d.command.trim();
    base.args = d.argsText.trim().split(/\s+/).filter(Boolean);
    base.cwd = d.cwd.trim();
    base.env = parseKvLines(d.envText);
  } else {
    base.url = d.url.trim();
    base.headers = parseKvLines(d.headersText);
  }
  return base;
}

export function publicMcpToDraft(m: McpServerPublic): McpDraft {
  return {
    id: m.id,
    name: m.name || m.id,
    enabled: m.enabled !== false,
    transport: m.transport || "http",
    command: m.command || "",
    argsText: (m.args || []).join(" "),
    cwd: m.cwd || "",
    url: m.url || "",
    envText: (m.envKeys || []).map((k) => `${k}=`).join("\n"),
    headersText: (m.headerKeys || []).map((k) => `${k}=`).join("\n"),
  };
}

export function mcpConnectionLabel(srv: McpDraft): string {
  if (srv.transport === "stdio") {
    const args = srv.argsText.trim();
    return args ? `${srv.command || "—"} ${args}` : srv.command || "—";
  }
  return srv.url || "—";
}
