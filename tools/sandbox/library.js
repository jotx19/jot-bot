/**
 * Automation Library — loads scripts only from a per-user remote pack URL
 * (Settings → Automation → Library repo URL).
 *
 * Remote pack root example:
 *   https://raw.githubusercontent.com/<org>/<repo>/<branch>
 *   → {URL}/catalog.json and {URL}/{file}
 *
 * No local / hardcoded scripts. Empty until a repo URL is set and reachable.
 */

import path from 'path';

/** @typedef {{
 *   id: string,
 *   name: string,
 *   title: string,
 *   description: string,
 *   category: string,
 *   defaultIntervalMs: number | null,
 *   requires: string[],
 *   file: string,
 *   origin?: string,
 * }} LibraryScriptMeta */

/** @typedef {LibraryScriptMeta & { code: string }} LibraryScript */

/** @type {Map<string, { at: number, entries: LibraryScriptMeta[], source: string }>} */
const catalogCache = new Map();

function cacheTtlMs() {
  const n = Number(process.env.AUTOMATION_LIBRARY_CACHE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 5 * 60 * 1000;
}

export function normalizeLibraryUrl(raw) {
  const url = String(raw || '').trim().replace(/\/$/, '');
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeEntry(raw, origin) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
  const name = String(raw.name || id)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  const file = String(raw.file || raw.path || '').trim();
  if (!id || !name || !file) return null;
  if (file.includes('..') || path.isAbsolute(file)) return null;

  const interval = raw.defaultIntervalMs;
  return {
    id,
    name,
    title: String(raw.title || name),
    description: String(raw.description || ''),
    category: String(raw.category || 'General'),
    defaultIntervalMs:
      typeof interval === 'number' && interval > 0 ? interval : null,
    requires: Array.isArray(raw.requires)
      ? raw.requires.map((r) => String(r))
      : [],
    file: file.replace(/^\.\//, ''),
    origin,
  };
}

function parseCatalogJson(text, origin) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.scripts;
  if (!Array.isArray(list)) {
    throw new Error('catalog.json must be an array or { scripts: [] }');
  }
  return list.map((row) => normalizeEntry(row, origin)).filter(Boolean);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json, text/plain, */*' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

/**
 * @param {{ force?: boolean, libraryUrl?: string|null }} [opts]
 * @returns {Promise<{ entries: LibraryScriptMeta[], source: string, connected: boolean, remoteError?: string }>}
 */
export async function loadLibraryCatalog({
  force = false,
  libraryUrl = null,
} = {}) {
  const base = normalizeLibraryUrl(libraryUrl);
  if (!base) {
    return { entries: [], source: '', connected: false };
  }

  const ttl = cacheTtlMs();
  const now = Date.now();
  const cached = catalogCache.get(base);
  if (!force && cached && now - cached.at < ttl) {
    return {
      entries: cached.entries,
      source: cached.source,
      connected: true,
    };
  }

  try {
    const text = await fetchText(`${base}/catalog.json`);
    const entries = parseCatalogJson(text, base);
    catalogCache.set(base, { at: now, source: base, entries });
    return { entries, source: base, connected: true };
  } catch (err) {
    console.warn(`[library] remote catalog failed (${err.message})`);
    catalogCache.delete(base);
    return {
      entries: [],
      source: '',
      connected: false,
      remoteError: err.message,
    };
  }
}

/**
 * @param {{ libraryUrl?: string|null, force?: boolean }} [opts]
 */
export async function listLibraryScripts(opts = {}) {
  const { entries, source, connected, remoteError } = await loadLibraryCatalog(
    opts
  );
  return {
    source,
    connected,
    remoteError: remoteError || null,
    libraryUrl: normalizeLibraryUrl(opts.libraryUrl) || null,
    scripts: entries.map(
      ({
        id,
        name,
        title,
        description,
        category,
        defaultIntervalMs,
        requires,
      }) => ({
        id,
        name,
        title,
        description,
        category,
        defaultIntervalMs,
        requires,
      })
    ),
  };
}

/**
 * @param {string} idOrName
 * @param {{ libraryUrl?: string|null }} [opts]
 * @returns {Promise<LibraryScript|null>}
 */
export async function getLibraryScript(idOrName, opts = {}) {
  const key = String(idOrName || '')
    .trim()
    .toLowerCase();
  if (!key) return null;

  const libraryUrl = normalizeLibraryUrl(opts.libraryUrl);
  if (!libraryUrl) return null;

  const { entries, connected } = await loadLibraryCatalog(opts);
  if (!connected) return null;

  const meta = entries.find((s) => s.id === key || s.name === key);
  if (!meta) return null;

  const origin = meta.origin || libraryUrl;
  const code = await fetchText(`${origin}/${meta.file}`);
  return { ...meta, origin, code: String(code || '').trim() + '\n' };
}

/** Clear in-memory catalog cache. */
export function clearLibraryCache(libraryUrl) {
  const base = normalizeLibraryUrl(libraryUrl);
  if (base) catalogCache.delete(base);
  else catalogCache.clear();
}

const META_BANNER_RE =
  /^\/\*\*\n \* tinyjot-automation\n[\s\S]*?\*\/\n*/;

/**
 * Read tinyjot-automation header fields from script source (if present).
 */
export function readAutomationMeta(code) {
  const text = String(code || '');
  const block = text.match(/^\/\*\*\n \* tinyjot-automation\n([\s\S]*?)\*\//);
  if (!block) return { libraryId: '', name: '', intervalMs: null };
  const body = block[1] || '';
  const libraryId = (body.match(/^\s*\* libraryId:\s*(.*)$/m)?.[1] || '').trim();
  const name = (body.match(/^\s*\* name:\s*(.*)$/m)?.[1] || '').trim();
  const rawInterval = (body.match(/^\s*\* intervalMs:\s*(.*)$/m)?.[1] || '').trim();
  const intervalMs =
    rawInterval && rawInterval !== 'null' && Number.isFinite(Number(rawInterval))
      ? Number(rawInterval)
      : null;
  return { libraryId, name, intervalMs };
}

/**
 * Stamp install overrides into script source so name/schedule stay in sync.
 */
export function applyAutomationMeta(code, { libraryId, name, intervalMs }) {
  const body = String(code || '').replace(META_BANNER_RE, '');
  const banner = [
    '/**',
    ' * tinyjot-automation',
    ` * libraryId: ${libraryId || ''}`,
    ` * name: ${name || ''}`,
    ` * intervalMs: ${intervalMs == null ? 'null' : String(intervalMs)}`,
    ' */',
    '',
  ].join('\n');
  return `${banner}${body}`.trimEnd() + '\n';
}
