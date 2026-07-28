const BUILTIN: Record<string, string> = {
  sandbox: "Sandbox",
  scheduler: "Scheduler",
  websearch: "Web search",
  recruiter: "Recruiter",
  "notion-append": "Notion · Update",
  "notion-create": "Notion · Create",
  "notion-delete": "Notion · Delete",
  "google-health": "Health",
  "fitbit-health": "Health",
};

const MCP_ACTIONS: Record<string, string> = {
  "API-post-page": "Create",
  "API-patch-block-children": "Update",
  "API-post-search": "Search",
  "API-get-page": "Open",
  "API-update-page": "Update",
  "API-retrieve-a-page": "Open",
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function simplifyRawTool(name: string): string {
  if (MCP_ACTIONS[name]) return MCP_ACTIONS[name];
  if (/^API-/i.test(name)) {
    return name
      .replace(/^API-/i, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return name.replace(/_/g, " ");
}

/** Human-readable label for toolUsed (e.g. mcp__notion__API-post-page → Notion · Create). */
export function formatToolLabel(toolUsed?: string | null): string {
  const raw = String(toolUsed || "").trim();
  if (!raw) return "";

  const builtin = BUILTIN[raw.toLowerCase()];
  if (builtin) return builtin;

  const mcp = raw.match(/^mcp__([a-z0-9_]+)__(.+)$/i);
  if (mcp) {
    const server = titleCase(mcp[1].replace(/_/g, " "));
    const action = simplifyRawTool(mcp[2]);
    if (MCP_ACTIONS[mcp[2]]) return `${server} · ${MCP_ACTIONS[mcp[2]]}`;
    return `${server} · ${action}`;
  }

  return simplifyRawTool(raw);
}

const INTENT_LABELS: Record<string, string> = {
  SEARCH: "Search",
  RECALL: "Memory",
  LEARN: "Learn",
  MCP_TASK: "Integration",
};

/** Badge text under assistant messages (intent + tool). */
export function formatMessageMeta(
  intent?: string | null,
  toolUsed?: string | null
): string {
  const tool = formatToolLabel(toolUsed);
  if (tool) return tool;

  const key = String(intent || "").toUpperCase();
  return INTENT_LABELS[key] || "";
}
