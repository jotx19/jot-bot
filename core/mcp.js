import { randomUUID } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getLlmContextStore } from './llm-context.js';
import { User, isMongoReady } from '../db/mongo.js';

export const MCP_MAX_SERVERS = 8;
const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 45_000;

/** Serialize stdio spawns — concurrent npx often yields "Connection closed". */
const stdioConnectLocks = new Map();

function isConnectionClosedError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return m.includes('connection closed') || m.includes('-32000');
}

async function withStdioConnectLock(serverId, fn) {
  const key = String(serverId || 'default');
  const prev = stdioConnectLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  stdioConnectLocks.set(
    key,
    prev.then(() => gate)
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (stdioConnectLocks.get(key) === gate) stdioConnectLocks.delete(key);
  }
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   enabled: boolean,
 *   transport: 'stdio' | 'http' | 'sse',
 *   command?: string,
 *   args?: string[],
 *   env?: Record<string, string>,
 *   cwd?: string,
 *   url?: string,
 *   headers?: Record<string, string>,
 * }} McpServerConfig
 */

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function sanitizeServerId(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
  return s || `mcp_${randomUUID().slice(0, 8)}`;
}

/**
 * Normalize + validate user-submitted MCP server configs.
 * @param {unknown} input
 * @returns {McpServerConfig[]}
 */
export function normalizeMcpServers(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();

  for (const raw of input.slice(0, MCP_MAX_SERVERS)) {
    if (!raw || typeof raw !== 'object') continue;
    const transport = String(raw.transport || 'http').toLowerCase();
    if (!['stdio', 'http', 'sse'].includes(transport)) continue;

    let id = sanitizeServerId(raw.id || raw.name);
    if (seen.has(id)) id = `${id}_${randomUUID().slice(0, 4)}`;
    seen.add(id);

    const name = String(raw.name || id).trim().slice(0, 64) || id;
    const enabled = raw.enabled !== false;

    /** @type {McpServerConfig} */
    const cfg = { id, name, enabled, transport };

    if (transport === 'stdio') {
      const command = String(raw.command || '').trim().slice(0, 256);
      if (!command) continue;
      cfg.command = command;
      cfg.args = Array.isArray(raw.args)
        ? raw.args.map((a) => String(a).slice(0, 256)).slice(0, 32)
        : String(raw.args || '')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 32);
      cfg.cwd = String(raw.cwd || '').trim().slice(0, 512) || undefined;
      cfg.env = sanitizeStringMap(raw.env, 24);
    } else {
      const url = String(raw.url || '').trim().slice(0, 2048);
      if (!url || !/^https?:\/\//i.test(url)) continue;
      cfg.url = url;
      cfg.headers = sanitizeStringMap(raw.headers, 16);
    }

    out.push(cfg);
  }

  return out;
}

function sanitizeStringMap(obj, maxKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, maxKeys)) {
    const key = String(k).trim().slice(0, 64);
    if (!key) continue;
    out[key] = String(v ?? '').slice(0, 2048);
  }
  return out;
}

/** Public shape — never expose secret values. */
export function publicMcpServers(servers) {
  return normalizeMcpServers(servers).map((s) => ({
    id: s.id,
    name: s.name,
    enabled: s.enabled,
    transport: s.transport,
    command: s.command || '',
    args: s.args || [],
    cwd: s.cwd || '',
    url: s.url || '',
    envKeys: Object.keys(s.env || {}),
    headerKeys: Object.keys(s.headers || {}),
    hasEnv: Object.keys(s.env || {}).length > 0,
    hasHeaders: Object.keys(s.headers || {}).length > 0,
  }));
}

/**
 * Merge updates for a server when client sends partial secrets
 * (empty env/header values mean "keep existing").
 */
export function mergeMcpServers(existing, incoming) {
  const prevById = new Map(normalizeMcpServers(existing).map((s) => [s.id, s]));
  const list = Array.isArray(incoming) ? incoming : [];
  const merged = [];

  for (const raw of list.slice(0, MCP_MAX_SERVERS)) {
    if (!raw || typeof raw !== 'object') continue;
    const id = sanitizeServerId(raw.id || raw.name);
    const prev = prevById.get(id);
    const combined = stripEmptySecrets({ ...(prev || {}), ...stripEmptySecrets(raw), id });

    if (prev) {
      if (!String(combined.command || '').trim() && prev.command) {
        combined.command = prev.command;
      }
      if ((!combined.args || !combined.args.length) && prev.args?.length) {
        combined.args = prev.args;
      }
      if (!String(combined.url || '').trim() && prev.url) combined.url = prev.url;
      if (prev.transport && !raw.transport) combined.transport = prev.transport;
      combined.env = mergeSecretMap(prev.env, combined.env);
      combined.headers = mergeSecretMap(prev.headers, combined.headers);
    }

    merged.push(combined);
  }

  return normalizeMcpServers(merged);
}

function mergeSecretMap(prev = {}, next = {}) {
  if (!next || typeof next !== 'object') return { ...(prev || {}) };
  const out = { ...(prev || {}) };
  for (const [k, v] of Object.entries(next)) {
    const val = String(v ?? '').trim();
    if (val) out[k] = val;
  }
  return out;
}

/** Drop empty env/header values so partial UI saves do not wipe secrets. */
export function stripEmptySecrets(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const out = { ...raw };
  if (out.env && typeof out.env === 'object') {
    out.env = Object.fromEntries(
      Object.entries(out.env).filter(([, v]) => String(v ?? '').trim())
    );
  }
  if (out.headers && typeof out.headers === 'object') {
    out.headers = Object.fromEntries(
      Object.entries(out.headers).filter(([, v]) => String(v ?? '').trim())
    );
  }
  return out;
}

function validateStdioMcpConfig(cfg) {
  if (cfg.transport !== 'stdio') return;
  const env = cfg.env || {};
  const nameHint = `${cfg.name || ''} ${cfg.command || ''} ${(cfg.args || []).join(' ')}`.toLowerCase();
  const needsNotion = nameHint.includes('notion') || (cfg.args || []).some((a) => /notion/i.test(a));
  if (needsNotion && !String(env.NOTION_TOKEN || env.OPENAPI_MCP_HEADERS || '').trim()) {
    throw new Error(
      'NOTION_TOKEN is missing. Open Settings → MCP → Env, paste NOTION_TOKEN=ntn_…, click Save MCP, then Test once.'
    );
  }
}

export function mcpToolName(serverId, toolName) {
  const safeTool = String(toolName || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  return `mcp__${sanitizeServerId(serverId)}__${safeTool}`;
}

export function parseMcpToolName(name) {
  const m = String(name || '').match(/^mcp__([a-z0-9_]+)__(.+)$/i);
  if (!m) return null;
  return { serverId: m[1].toLowerCase(), toolName: m[2] };
}

export function isMcpToolName(name) {
  return Boolean(parseMcpToolName(name));
}

async function connectClient(cfg) {
  validateStdioMcpConfig(cfg);

  const client = new Client(
    { name: 'tinyjot', version: '1.0.0' },
    { capabilities: {} }
  );

  let transport;
  if (cfg.transport === 'stdio') {
    transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args || [],
      env: { ...getDefaultEnvironment(), ...(cfg.env || {}) },
      cwd: cfg.cwd || undefined,
      stderr: 'pipe',
    });
  } else if (cfg.transport === 'sse') {
    transport = new SSEClientTransport(new URL(cfg.url), {
      requestInit: {
        headers: cfg.headers || {},
      },
    });
  } else {
    // Prefer streamable HTTP; callers may retry with sse on failure.
    transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: {
        headers: cfg.headers || {},
      },
    });
  }

  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `MCP connect ${cfg.id}`);
  return { client, transport };
}

async function connectWithFallback(cfg) {
  const run = () =>
    cfg.transport === 'http'
      ? connectClient(cfg).catch((err) => {
          console.warn(`[mcp] ${cfg.id} streamable HTTP failed, trying SSE:`, err.message);
          return connectClient({ ...cfg, transport: 'sse' });
        })
      : connectClient(cfg);

  if (cfg.transport === 'stdio') {
    return withStdioConnectLock(cfg.id, run);
  }
  return run();
}

/**
 * Per-request MCP session — connect lazily, close when the chat turn ends.
 */
export class McpSession {
  /** @param {McpServerConfig[]} configs */
  constructor(configs) {
    this.configs = normalizeMcpServers(configs).filter((c) => c.enabled);
    /** @type {Map<string, { client: Client, tools: Array<{ name: string, description?: string, inputSchema?: object }> }>} */
    this.connections = new Map();
  }

  async ensure(serverId, { force = false } = {}) {
    if (!force && this.connections.has(serverId)) return this.connections.get(serverId);
    if (force && this.connections.has(serverId)) {
      const stale = this.connections.get(serverId);
      this.connections.delete(serverId);
      try {
        await stale.client.close();
      } catch {
        /* ignore */
      }
    }

    const cfg = this.configs.find((c) => c.id === serverId);
    if (!cfg) throw new Error(`Unknown MCP server: ${serverId}`);

    const { client } = await connectWithFallback(cfg);
    const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `MCP listTools ${serverId}`);
    const tools = (listed?.tools || []).map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema,
    }));
    const entry = { client, tools };
    this.connections.set(serverId, entry);
    console.log(`[mcp] connected ${cfg.name} (${cfg.id}) — ${tools.length} tool(s)`);
    return entry;
  }

  /**
   * @returns {Promise<Array<{ name: string, description: string, mcp: true, serverId: string, serverName: string }>>}
   */
  async listCatalog() {
    const catalog = [];
    for (const cfg of this.configs) {
      try {
        const entry = await this.ensure(cfg.id);
        for (const t of entry.tools) {
          catalog.push({
            name: mcpToolName(cfg.id, t.name),
            description: `[MCP:${cfg.name}] ${t.description || t.name}`,
            mcp: true,
            serverId: cfg.id,
            serverName: cfg.name,
          });
        }
      } catch (err) {
        console.warn(`[mcp] skip ${cfg.id}:`, err.message);
      }
    }
    return catalog;
  }

  /**
   * @param {string} qualifiedName mcp__server__tool
   * @param {string|object} input
   */
  async callTool(qualifiedName, input) {
    const parsed = parseMcpToolName(qualifiedName);
    if (!parsed) throw new Error(`Not an MCP tool: ${qualifiedName}`);

    try {
      return await this._callTool(parsed, qualifiedName, input);
    } catch (err) {
      if (!isConnectionClosedError(err)) throw err;
      console.warn(`[mcp] ${parsed.serverId} connection closed — reconnecting`);
      await this.ensure(parsed.serverId, { force: true });
      return this._callTool(parsed, qualifiedName, input);
    }
  }

  async _callTool(parsed, qualifiedName, input) {
    const entry = await this.ensure(parsed.serverId);
    const toolMeta = entry.tools.find((t) => t.name === parsed.toolName);
    if (!toolMeta) {
      const alt = entry.tools.find(
        (t) => mcpToolName(parsed.serverId, t.name) === qualifiedName
      );
      if (!alt) throw new Error(`MCP tool not found: ${parsed.toolName}`);
      return this._call(entry.client, alt.name, alt.inputSchema, input);
    }
    return this._call(entry.client, toolMeta.name, toolMeta.inputSchema, input);
  }

  async _call(client, toolName, inputSchema, input) {
    const args = coerceToolArguments(input, inputSchema);
    const result = await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      CALL_TIMEOUT_MS,
      `MCP call ${toolName}`
    );
    return formatCallResult(result);
  }

  async close() {
    for (const [id, entry] of this.connections) {
      try {
        await entry.client.close();
      } catch (err) {
        console.warn(`[mcp] close ${id}:`, err.message);
      }
    }
    this.connections.clear();
  }
}

function coerceToolArguments(input, inputSchema) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  const text = input == null ? '' : String(input).trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* not JSON */
  }

  const props = inputSchema?.properties && typeof inputSchema.properties === 'object'
    ? Object.keys(inputSchema.properties)
    : [];

  if (props.includes('path')) {
    const pathMatch =
      text.match(/\b(\/(?:[\w.~-]+(?:\/[\w.~-]*)*))\b/) ||
      text.match(/\b(\/tmp)\b/i);
    if (pathMatch) return { path: pathMatch[1] };
    if (/^\/[\w.~/ -]+$/.test(text)) return { path: text.trim() };
  }

  if (props.length === 1) return { [props[0]]: text };
  if (props.includes('query')) return { query: text };
  if (props.includes('input')) return { input: text };
  if (props.includes('prompt')) return { prompt: text };
  if (props.includes('message')) return { message: text };
  return { input: text };
}

function formatCallResult(result) {
  if (!result) return { ok: false, content: '' };
  const parts = [];
  for (const block of result.content || []) {
    if (block?.type === 'text' && block.text) parts.push(block.text);
    else if (block?.type === 'resource' && block.resource) {
      parts.push(JSON.stringify(block.resource));
    } else if (block) {
      parts.push(JSON.stringify(block));
    }
  }
  const text = parts.join('\n\n').trim();
  let isError = Boolean(result.isError);
  if (!isError && text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.object === 'error' || parsed?.code === 'validation_error') {
        isError = true;
      }
    } catch {
      /* not JSON */
    }
  }
  return {
    ok: !isError,
    content: text || (result.structuredContent ? JSON.stringify(result.structuredContent) : ''),
    isError,
    structuredContent: result.structuredContent ?? null,
  };
}

/** Probe a single config (settings Test button). */
export async function testMcpServer(cfg) {
  const normalized = normalizeMcpServers([cfg])[0];
  if (!normalized) throw new Error('Invalid MCP server config');

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = new McpSession([{ ...normalized, enabled: true }]);
    try {
      const entry = await session.ensure(normalized.id, { force: attempt > 0 });
      return {
        ok: true,
        serverId: normalized.id,
        tools: entry.tools.map((t) => ({
          name: t.name,
          description: t.description || '',
        })),
      };
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && isConnectionClosedError(err)) {
        console.warn('[mcp/test] connection closed, retrying…');
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw err;
    } finally {
      await session.close();
    }
  }
  throw lastErr || new Error('MCP test failed');
}

export function hasEnabledMcpServers() {
  const store = getLlmContextStore();
  if (!store) return false;
  return normalizeMcpServers(store.mcpServers || []).some((s) => s.enabled);
}

/** Like hasEnabledMcpServers but reloads from Mongo when the request context is empty. */
export async function hasEnabledMcpServersAsync() {
  const store = getLlmContextStore();
  if (!store) return false;
  const configs = enabledMcpConfigs(await resolveMcpConfigs(store));
  return configs.length > 0;
}

/** Heuristic: user wants an MCP tool (files, dirs, connected integrations). */
export function isLikelyMcpTaskRequest(message) {
  const m = String(message || '').toLowerCase();
  if (/\b(use|call|run)\s+(my\s+)?mcp\b/.test(m)) return true;
  if (
    /\b(list|show|read|open|browse|explore|what'?s in|contents of)\b/.test(m) &&
    /\b(file|files|folder|directory|dir|path|tmp|\/[a-z0-9_.-]+)\b/i.test(message)
  ) {
    return true;
  }
  if (/\bls\s+(\/|\.\/|~\/|[a-z]:\\)/i.test(message)) return true;
  // Connected integrations (Notion MCP, etc.) — not sandbox scripts
  if (/\bnotion\b/.test(m) && !/\b(script|tool|sandbox|node\.js)\b/.test(m)) return true;
  if (/\b(?:in|to)\s+.+\s+add\s+.+/i.test(message)) return true;
  if (
    /\b(create|add|save|update|write|append|post)\b/.test(m) &&
    /\b(page|database|entry|note|block|workspace)\b/.test(m) &&
    !/\b(script|tool|sandbox|node\.js)\b/.test(m)
  ) {
    return true;
  }
  return false;
}

export function mcpConfigsFromUserDoc(userDoc) {
  return normalizeMcpServers(userDoc?.settings?.mcpServers || []);
}

/** Only servers the user has left enabled (used for chat connections). */
export function enabledMcpConfigs(configs) {
  return normalizeMcpServers(configs).filter((c) => c.enabled);
}

export function enabledMcpConfigsFromUserDoc(userDoc) {
  return enabledMcpConfigs(userDoc?.settings?.mcpServers || []);
}

/** Reload MCP configs from Mongo when the request context is empty. */
async function resolveMcpConfigs(store) {
  if (store?.userId && isMongoReady()) {
    try {
      const user = await User.findById(store.userId).select('settings.mcpServers').lean();
      const fromDb = normalizeMcpServers(user?.settings?.mcpServers || []);
      if (fromDb.length) {
        store.mcpServers = fromDb;
        return fromDb;
      }
      if (user?.settings?.mcpServers?.length) {
        console.warn(
          `[mcp] ${user.settings.mcpServers.length} server(s) in DB but none passed validation — check command/url in Settings → MCP`
        );
      }
    } catch (err) {
      console.warn('[mcp] DB reload failed:', err.message);
    }
  }

  const configs = normalizeMcpServers(store?.mcpServers || []);
  if (configs.length) return configs;

  if (store?.userId) {
    console.warn(
      `[mcp] no servers for user ${store.userId} — add Notion in Settings → MCP and click Save MCP (Test alone does not persist)`
    );
  }
  return [];
}

function findMcpTool(mcpTools, ...patterns) {
  for (const pattern of patterns) {
    const hit = mcpTools.find(
      (t) => pattern.test(t.name) || pattern.test(String(t.description || ''))
    );
    if (hit) return hit;
  }
  return null;
}

function extractNotionTitle(message) {
  const m = String(message).match(
    /(?:titled|called|named|title)\s+["'“]([^"'”]+)["'”]|(?:titled|called|named|title)\s+([^\n,.]+?)(?:\s+with|\s+in|\s+under|\s*$)/i
  );
  return (m?.[1] || m?.[2] || '').trim() || null;
}

export function extractNotionParent(message) {
  const m = String(message).match(
    /\bunder\s+["'“]?([^"'\n,.]+?)["'”]?(?:\s*$|\s+with|\s+and|\s+in)/i
  );
  const name = m?.[1]?.trim() || null;
  if (!name || /<[^>]+>/.test(name) || /^that page name$/i.test(name)) return null;
  return name;
}

export function isNotionCreatePageMessage(message) {
  const text = String(message || '');
  if (isNotionAppendToPageMessage(text)) return false;
  if (isNotionDeletePageMessage(text)) return false;
  return (
    /\b(create|add|make|new|write)\b/i.test(text) &&
    /\b(page|note)\b/i.test(text) &&
    (/\bnotion\b/i.test(text) || extractNotionTitle(text))
  );
}

export function isNotionDeletePageMessage(message, options = {}) {
  return Boolean(extractNotionDeleteTarget(message, options));
}

export function extractNotionDeleteTarget(message, { force = false } = {}) {
  const text = String(message || '').trim();
  if (!/\b(delete|remove|trash|archive)\b/i.test(text)) return null;
  if (!force && !/\bnotion\b/i.test(text) && !/\bpage\b/i.test(text)) return null;

  let m = text.match(
    /\b(?:delete|remove|trash|archive)\s+(?:the\s+)?(?:notion\s+)?(?:page\s+)?["'“]([^"'”]+)["'”]\s*(?:from\s+notion)?\s*$/i
  );
  if (m?.[1]) return m[1].trim();

  m = text.match(
    /\b(?:delete|remove|trash|archive)\s+(?:the\s+)?(?:notion\s+)?page\s+(.+?)\s*$/i
  );
  if (m?.[1]) return m[1].replace(/\s+from\s+notion\s*$/i, '').trim();

  m = text.match(
    /\b(?:delete|remove|trash|archive)\s+(.+?)\s+from\s+notion\b/i
  );
  if (m?.[1]) {
    return m[1]
      .replace(/^(?:the\s+)?(?:notion\s+)?(?:page\s+)?/i, '')
      .trim();
  }

  if (force) {
    m = text.match(/\b(?:delete|remove|trash|archive)\s+(.+)/i);
    if (m?.[1]) {
      return m[1]
        .replace(/\s+from\s+notion\s*$/i, '')
        .replace(/^(?:the\s+)?(?:notion\s+)?(?:page\s+)?/i, '')
        .trim();
    }
  }

  return null;
}

/** e.g. "in Test from tinyjot add hello" */
export function isNotionAppendToPageMessage(message) {
  return Boolean(extractNotionAppendTarget(message));
}

export function extractNotionAppendTarget(message) {
  const text = String(message || '');
  let m = text.match(/\bin\s+(?:this\s+)?["'“]([^"'”]+)["'”]\s+add\s+(.+)/i);
  if (m) return { pageName: m[1].trim(), content: m[2].trim() };
  m = text.match(/\bin\s+(?:this\s+)?(.+?)\s+add\s+(.+)/i);
  if (m) return { pageName: m[1].trim(), content: m[2].trim() };
  m = text.match(/\badd\s+(.+?)\s+to\s+(?:notion\s+page\s+)?["'“]?([^"'”]+)["'”]?$/i);
  if (m) return { content: m[1].trim(), pageName: m[2].trim() };
  return null;
}

function extractNotionBodyContent(message) {
  const m = String(message || '').match(
    /\b(?:with|saying|content|body)\s+["'“]([^"'”]+)["'”]|\b(?:with|saying|content|body)\s+([^\n,.]+?)(?:\s+under|\s*$)/i
  );
  return (m?.[1] || m?.[2] || '').trim() || null;
}

function notionParagraphChildren(text) {
  const content = String(text || '').trim();
  if (!content) return [];
  const blocks = [];
  for (let i = 0; i < content.length; i += 2000) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: content.slice(i, i + 2000) } }],
      },
    });
  }
  return blocks;
}

function extractJsonFromMcpContent(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

function pageTitleFromNotionItem(item) {
  const props = item?.properties || {};
  const titleProp = props.title || props.Title || props.Name || props.name;
  return (
    titleProp?.title?.[0]?.plain_text ||
    titleProp?.rich_text?.[0]?.plain_text ||
    item?.title?.[0]?.plain_text ||
    item?.title?.[0]?.text?.content ||
    ''
  );
}

function findTitlePropertyKey(item) {
  const props = item?.properties || {};
  for (const [key, val] of Object.entries(props)) {
    if (val?.type === 'title') return key;
  }
  if (props.Name) return 'Name';
  if (props.title) return 'title';
  return 'Name';
}

/**
 * @returns {{ id: string, kind: 'page'|'database'|'data_source', title: string, item?: object } | null}
 */
function parseNotionParentMatch(content, parentName) {
  const want = String(parentName || '').toLowerCase();
  const data = extractJsonFromMcpContent(content);
  if (!data) return null;

  const results = data.results || data.pages || (Array.isArray(data) ? data : []);
  let best = null;
  let bestScore = -1;

  for (const item of results) {
    const kind =
      item.object === 'page'
        ? 'page'
        : item.object === 'database'
          ? 'database'
          : item.object === 'data_source'
            ? 'data_source'
            : null;
    if (!kind || !item.id) continue;

    const plain = pageTitleFromNotionItem(item);
    const hay = plain.toLowerCase();
    let score = 0;
    if (want && hay === want) score = 100;
    else if (want && hay.includes(want)) score = 80;
    else if (want && want.includes(hay) && hay.length > 2) score = 60;
    else if (!want) score = 20;

    if (score > bestScore) {
      bestScore = score;
      best = { id: item.id, kind, title: plain, item };
    }
  }

  if (!best && results.length) {
    const item = results.find((r) =>
      ['page', 'database', 'data_source'].includes(r.object)
    );
    if (item) {
      best = {
        id: item.id,
        kind: item.object,
        title: pageTitleFromNotionItem(item),
        item,
      };
    }
  }
  return best;
}

async function notionSearchParent(session, searchTool, parentName) {
  const names = parentName
    ? [parentName, parentName.split(/\s+/)[0]]
    : ['Todo List', "Intellectual Eminent's Space", ''];

  const filters = [
    undefined,
    { property: 'object', value: 'page' },
    { property: 'object', value: 'data_source' },
    { property: 'object', value: 'database' },
  ];

  const payloads = [];
  for (const query of names) {
    for (const filter of filters) {
      payloads.push(filter ? { query, filter } : { query });
    }
  }

  for (const payload of payloads) {
    const searchResult = await session.callTool(searchTool.name, JSON.stringify(payload));
    if (searchResult.isError) continue;

    const match = parseNotionParentMatch(searchResult.content, parentName || payload.query);
    if (match?.id) {
      console.log(
        `[mcp/notion] found ${match.kind} "${match.title}" (${match.id}) via ${JSON.stringify(payload).slice(0, 80)}`
      );
      return { parent: match, searchResult };
    }
  }
  return { parent: null, searchResult: null };
}

async function notionFindPageByTitle(session, searchTool, pageName) {
  const want = String(pageName || '').toLowerCase();
  const payloads = [
    { query: pageName, filter: { property: 'object', value: 'page' } },
    { query: pageName },
    { query: pageName.split(/\s+/)[0], filter: { property: 'object', value: 'page' } },
  ];

  for (const payload of payloads) {
    const searchResult = await session.callTool(searchTool.name, JSON.stringify(payload));
    if (searchResult.isError) continue;
    const data = extractJsonFromMcpContent(searchResult.content);
    const results = data?.results || [];
    for (const item of results) {
      if (item.object !== 'page') continue;
      const title = pageTitleFromNotionItem(item).toLowerCase();
      if (title === want || title.includes(want) || want.includes(title)) {
        return { id: item.id, title: pageTitleFromNotionItem(item), item };
      }
    }
  }
  return null;
}

/**
 * Append paragraph blocks to an existing Notion page.
 */
export async function notionAppendToPage(session, mcpTools, message) {
  const parsed = extractNotionAppendTarget(message);
  if (!parsed?.pageName || !parsed?.content) {
    return {
      ok: false,
      isError: true,
      content: 'Try: In "Test from tinyjot" add hello',
      toolUsed: 'notion-append',
    };
  }

  const searchTool = findMcpTool(mcpTools, /API-post-search$/i);
  const patchTool = findMcpTool(mcpTools, /API-patch-block-children$/i);
  if (!searchTool || !patchTool) {
    return {
      ok: false,
      isError: true,
      content: 'Notion search or patch-block-children tool not available.',
      toolUsed: 'notion-append',
    };
  }

  console.log(`[mcp/notion] finding page "${parsed.pageName}" to append content`);
  const page = await notionFindPageByTitle(session, searchTool, parsed.pageName);
  if (!page?.id) {
    return {
      ok: false,
      isError: true,
      content: `Could not find Notion page **${parsed.pageName}**. Create it first, then append content.`,
      toolUsed: searchTool.name,
    };
  }

  const children = notionParagraphChildren(parsed.content);
  const payloads = [
    { block_id: page.id, children },
    { children, block_id: page.id },
  ];

  let lastError = '';
  for (const payload of payloads) {
    console.log(`[mcp/notion] appending to page ${page.id}`);
    const result = await session.callTool(patchTool.name, JSON.stringify(payload));
    if (!result.isError) {
      return {
        ...result,
        toolUsed: patchTool.name,
        content:
          result.content ||
          `Added content to **${page.title}**:\n\n${parsed.content}`,
      };
    }
    lastError = String(result.content || '');
  }

  return { ok: false, isError: true, content: lastError, toolUsed: patchTool.name };
}

/**
 * Trash/archive a Notion page by title (Notion API: archived / in_trash).
 */
export async function notionDeletePage(session, mcpTools, message, options = {}) {
  const pageName = extractNotionDeleteTarget(message, {
    force: options.force === true || options.preferTool === 'notion',
  });
  if (!pageName) {
    return {
      ok: false,
      isError: true,
      content: 'Try: Delete "Test from tinyjot" from Notion',
      toolUsed: 'notion-delete',
    };
  }

  const searchTool = findMcpTool(mcpTools, /API-post-search$/i, /__post[-_]search$/i, /__search$/i);
  const updateTool = findMcpTool(
    mcpTools,
    /API-update-a-page$/i,
    /API-patch-page$/i,
    /API-update-page$/i,
    /__update[-_](?:a[-_])?page$/i,
    /archive[-_]?page$/i
  );

  if (!searchTool) {
    return {
      ok: false,
      isError: true,
      content: 'Notion search tool not available.',
      toolUsed: 'notion-delete',
    };
  }
  if (!updateTool) {
    return {
      ok: false,
      isError: true,
      content:
        'Notion update/archive tool not available on this MCP server. Delete the page manually in Notion (⋯ → Delete).',
      toolUsed: 'notion-delete',
    };
  }

  console.log(`[mcp/notion] finding page "${pageName}" to trash`);
  const page = await notionFindPageByTitle(session, searchTool, pageName);
  if (!page?.id) {
    return {
      ok: false,
      isError: true,
      content: `Could not find Notion page **${pageName}**.`,
      toolUsed: searchTool.name,
    };
  }

  const payloads = [
    { page_id: page.id, archived: true },
    { page_id: page.id, in_trash: true },
    { page_id: page.id, properties: {}, archived: true },
    { page_id: page.id, properties: {}, in_trash: true },
  ];

  let lastError = '';
  for (const payload of payloads) {
    console.log(`[mcp/notion] trashing page ${page.id} via ${updateTool.name}`);
    const result = await session.callTool(updateTool.name, JSON.stringify(payload));
    if (!result.isError) {
      const data = extractJsonFromMcpContent(result.content);
      const title =
        (data && pageTitleFromNotionItem(data)) || page.title || pageName;
      return {
        ...result,
        toolUsed: updateTool.name,
        content: `**Moved to Notion trash:** ${title}\n\n_Recoverable for ~30 days in Notion trash._`,
      };
    }
    lastError = String(result.content || '');
  }

  return {
    ok: false,
    isError: true,
    content:
      (lastError || `Could not trash page "${page.title}".`) +
      `\n\nIf this keeps failing, delete it in Notion: open the page → ⋯ → Delete.`,
    toolUsed: updateTool.name,
  };
}

function notionPageCreatePayloads(title, parent, bodyText) {
  if (!parent?.id) return [];

  const children = notionParagraphChildren(bodyText || '');

  const payloads = [];
  if (parent.kind === 'page') {
    payloads.push({
      parent: { page_id: parent.id },
      properties: {
        title: { title: [{ type: 'text', text: { content: title } }] },
      },
      children,
    });
    return payloads;
  }

  const titleKey = findTitlePropertyKey(parent.item);
  const titleProp = { title: [{ type: 'text', text: { content: title } }] };
  const base = { properties: { [titleKey]: titleProp }, children };

  if (parent.kind === 'data_source') {
    payloads.push({
      ...base,
      parent: { data_source_id: parent.id },
    });
  }
  payloads.push({
    ...base,
    parent: { database_id: parent.id },
  });
  return payloads;
}

/**
 * Search for parent page then create a child page (Notion MCP).
 * @returns {Promise<{ ok: boolean, content: string, isError: boolean, toolUsed: string }>}
 */
export async function notionCreatePage(session, mcpTools, message) {
  const title = extractNotionTitle(message);
  const parentName = extractNotionParent(message);
  const bodyText = extractNotionBodyContent(message);
  if (!title) {
    return {
      ok: false,
      isError: true,
      content: 'Could not parse page title. Try: Create a Notion page titled "My Page" under Home',
      toolUsed: 'notion-create',
    };
  }

  const searchTool = findMcpTool(mcpTools, /API-post-search$/i);
  const createTool = findMcpTool(mcpTools, /API-post-page$/i);
  if (!createTool) {
    return {
      ok: false,
      isError: true,
      content: 'Notion API-post-page tool not found on MCP server.',
      toolUsed: 'notion-create',
    };
  }

  let parent = null;
  if (searchTool) {
    console.log(`[mcp/notion] searching parent "${parentName || 'Todo List (default)'}"`);
    const found = await notionSearchParent(session, searchTool, parentName);
    parent = found.parent;
    if (found.searchResult?.isError) {
      return { ...found.searchResult, toolUsed: searchTool.name };
    }
    console.log(`[mcp/notion] parent: ${parent ? `${parent.kind} ${parent.id}` : 'not found'}`);
  }

  if (!parent?.id) {
    return {
      ok: false,
      isError: true,
      content:
        `Could not find a Notion page or database${parentName ? ` named "${parentName}"` : ''}.\n\n` +
        `**Try:**\n` +
        `Create a Notion page titled "${title}" under Todo List\n\n` +
        `Make sure **Todo List** is in Notion developers → tinyjot → **Content access** (you already added it ✅).`,
      toolUsed: searchTool?.name || createTool.name,
    };
  }

  const createPayloads = notionPageCreatePayloads(title, parent, bodyText);
  let lastError = '';

  for (const payload of createPayloads) {
    console.log(`[mcp/notion] creating page "${title}" parent=${JSON.stringify(payload.parent)}`);
    const createResult = await session.callTool(createTool.name, JSON.stringify(payload));
    if (!createResult.isError) {
      return { ...createResult, toolUsed: createTool.name };
    }
    lastError = String(createResult.content || '');
  }

  return {
    ok: false,
    isError: true,
    content:
      (lastError || `Could not create page under "${parent.title || parentName}".`) +
      `\n\n**Tips:**\n` +
      `- Todo List may be a database — we now support that\n` +
      `- Retry: Create a Notion page titled "${title}" under Todo List`,
    toolUsed: createTool.name,
  };
}

/**
 * Last-resort MCP tool pick when the LLM router returns bad JSON.
 * @returns {{ tool: string, input: string } | null}
 */
export function fallbackMcpPick(message, mcpTools) {
  if (!mcpTools?.length) return null;

  const direct = tryDirectMcpPick(message, mcpTools);
  if (direct) return direct;

  const text = String(message || '');
  const title = extractNotionTitle(text);

  if (/\b(create|add|make|new|write|save)\b/i.test(text) && /\b(page|note)\b/i.test(text)) {
    return null;
  }

  if (/\bnotion\b/i.test(text)) {
    const search = findMcpTool(
      mcpTools,
      /API-post-search$/i,
      /__post[-_]search$/i,
      /__search$/i,
      /search/i
    );
    if (search) {
      const query = title || text.replace(/\bnotion\b/gi, '').trim().slice(0, 120);
      return { tool: search.name, input: JSON.stringify({ query: query || 'pages' }) };
    }
  }

  return null;
}

/**
 * Skip the LLM tool router for obvious filesystem MCP requests.
 * @returns {{ tool: string, input: string } | null}
 */
export function tryDirectMcpPick(message, mcpTools) {
  if (!mcpTools?.length || !isLikelyMcpTaskRequest(message)) return null;

  const text = String(message || '');
  const pathMatch =
    text.match(/\b(\/(?:[\w.~-]+(?:\/[\w.~-]*)*))\b/) || text.match(/\b(\/tmp)\b/i);
  const path = pathMatch?.[1] || '/tmp';

  const listDir = mcpTools.find((t) => /__list_directory$/i.test(t.name));
  if (listDir && /\b(list|show|ls|files|contents|what'?s in|directory)\b/i.test(text)) {
    return { tool: listDir.name, input: JSON.stringify({ path }) };
  }

  const readFile = mcpTools.find(
    (t) => /__read_(?:text_)?file$/i.test(t.name) || /__read_file$/i.test(t.name)
  );
  if (readFile && /\b(read|open|cat)\b.*\b(file)?\b/i.test(text) && pathMatch) {
    return { tool: readFile.name, input: JSON.stringify({ path }) };
  }

  if (/\bnotion\b/i.test(text) || (/\b(create|add|save|update)\b/i.test(text) && /\bpage\b/i.test(text))) {
    const title = extractNotionTitle(text);

    if (/\b(create|add|make|new|write|save)\b/i.test(text) && /\b(page|note)\b/i.test(text)) {
      // Handled by notionCreatePage() — skip broken { title } only pick
      return null;
    }

    const search = findMcpTool(mcpTools, /API-post-search$/i, /__post[-_]search$/i, /__search$/i);
    if (search && /\b(search|find|list|show)\b/i.test(text)) {
      const query = title || text.replace(/\bnotion\b/gi, '').trim().slice(0, 120);
      return { tool: search.name, input: JSON.stringify({ query: query || 'pages' }) };
    }
  }

  return null;
}

export function getOrCreateMcpSession() {
  const store = getLlmContextStore();
  if (!store) {
    console.warn('[mcp] no ALS context for this request');
    return null;
  }
  if (store.mcpSession) return store.mcpSession;
  const configs = enabledMcpConfigs(normalizeMcpServers(store.mcpServers || []));
  if (!configs.length) {
    console.warn('[mcp] no enabled servers in request context — enable in Settings → MCP and Save');
    return null;
  }
  store.mcpServers = configs;
  store.mcpSession = new McpSession(configs);
  return store.mcpSession;
}

export async function getOrCreateMcpSessionAsync() {
  const store = getLlmContextStore();
  if (!store) {
    console.warn('[mcp] no ALS context for this request');
    return null;
  }
  if (store.mcpSession) return store.mcpSession;

  const configs = enabledMcpConfigs(await resolveMcpConfigs(store));
  if (!configs.length) {
    console.warn('[mcp] no enabled servers — turn on in Settings → MCP and Save');
    return null;
  }

  store.mcpServers = configs;
  store.mcpSession = new McpSession(configs);
  return store.mcpSession;
}

export async function listMcpToolsForRequest() {
  const session = await getOrCreateMcpSessionAsync();
  if (!session) return [];
  return session.listCatalog();
}

export async function callMcpToolForRequest(name, input, session = null) {
  const active = session || (await getOrCreateMcpSessionAsync());
  if (!active) {
    throw new Error(
      'No MCP servers configured for this request. Open Settings → MCP, add your server, and click Save MCP.'
    );
  }
  return active.callTool(name, input);
}

export async function closeMcpSessionForRequest() {
  const store = getLlmContextStore();
  if (!store?.mcpSession) return;
  try {
    await store.mcpSession.close();
  } finally {
    store.mcpSession = null;
  }
}
