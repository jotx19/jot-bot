import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SandboxScript, isMongoReady } from '../../db/mongo.js';
import { prepareSandboxCode } from './sanitize.js';
import { unregisterTool } from '../registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const STATE_DIR = path.join(__dirname, 'state');

const PROTECTED_STATE_FILES = new Set(['scheduled.json', '.gitkeep']);

const SKIP_NAMES = new Set(['a', 'the', 'it', 'this', 'that', 'script', 'tool', 'sandbox']);

/** Pull script name from natural-language input (before defaulting to custom_tool). */
export function extractScriptNameFromInput(inputStr) {
  const patterns = [
    /\bscript\s+called\s+["']?([a-z][a-z0-9_-]*)/i,
    /\bcalled\s+["']?([a-z][a-z0-9_-]*)/i,
    /\bnamed\s+["']?([a-z][a-z0-9_-]*)/i,
  ];
  for (const p of patterns) {
    const m = inputStr.match(p);
    const raw = m?.[1]?.toLowerCase();
    if (raw && !SKIP_NAMES.has(raw)) {
      return raw.replace(/[^a-z0-9_]/g, '_');
    }
  }
  return null;
}

const NAME_STOP_WORDS = new Set([
  ...SKIP_NAMES,
  'make',
  'create',
  'build',
  'write',
  'save',
  'store',
  'persist',
  'run',
  'execute',
  'test',
  'try',
  'please',
  'for',
  'with',
  'from',
  'into',
  'and',
  'or',
  'me',
  'my',
  'new',
  'another',
  'one',
  'more',
  'second',
  'third',
  'different',
  'every',
  'minute',
  'hour',
  'seconds',
  'minutes',
  'hours',
]);

/**
 * Suggest a readable base name from the request when the user did not name the script.
 */
export function suggestScriptNameFromInput(inputStr) {
  const extracted = extractScriptNameFromInput(inputStr);
  if (extracted) return extracted;

  const words = (String(inputStr).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).filter(
    (w) => !NAME_STOP_WORDS.has(w)
  );
  const picked = words.slice(0, 3);
  if (picked.length) return picked.join('_').slice(0, 40);
  return 'sandbox_script';
}

/**
 * Return `base` if unused, otherwise `base_2`, `base_3`, …
 * so create requests never silently overwrite an existing script.
 */
export async function ensureUniqueScriptName(baseName) {
  let name = String(baseName || 'sandbox_script')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();
  if (!name) name = 'sandbox_script';

  const taken = async (n) => {
    if (fs.existsSync(scriptPathFor(n))) return true;
    if (!isMongoReady()) return false;
    return Boolean(await SandboxScript.exists({ name: n }));
  };

  if (!(await taken(name))) return name;

  for (let i = 2; i <= 100; i++) {
    const candidate = `${name}_${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${name}_${Date.now()}`;
}

/** True when the user asked to edit an existing script (overwrite allowed). */
export function isScriptOverwriteRequest(inputStr) {
  const m = String(inputStr || '').toLowerCase();
  if (/\b(another|a new|new script|different|second|third|one more)\b/.test(m)) {
    return false;
  }
  return /\b(update|modify|change|fix|overwrite|replace|edit)\b/.test(m);
}

export function removeLegacyToolFile(name) {
  const fp = path.join(TOOLS_DIR, `${name}.generated.js`);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
    console.log(`[sandbox] removed legacy tool file ${fp}`);
  }
}

const MAX_SCRIPTS = Number(process.env.SANDBOX_MAX_SCRIPTS) || 15;
const MAX_CODE_BYTES = Number(process.env.SANDBOX_MAX_CODE_BYTES) || 32768;

export function scriptPathFor(name) {
  return path.join(SCRIPTS_DIR, `${name}.mjs`);
}

export function materializeOnDisk(name, code) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  const scriptPath = scriptPathFor(name);
  fs.writeFileSync(scriptPath, prepareSandboxCode(code), 'utf8');
  return scriptPath;
}

export function removeFromDisk(name) {
  const scriptPath = scriptPathFor(name);
  if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
}

/** Remove state files created by a script (e.g. ping_once_state.json). */
export function removeScriptStateFiles(name) {
  if (!fs.existsSync(STATE_DIR)) return [];

  const prefix = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const removed = [];

  for (const file of fs.readdirSync(STATE_DIR)) {
    if (PROTECTED_STATE_FILES.has(file)) continue;
    const lower = file.toLowerCase();
    const owned =
      lower === `${prefix}.json` ||
      lower.startsWith(`${prefix}_`) ||
      lower.startsWith(`${prefix}.`);
    if (!owned) continue;

    const fp = path.join(STATE_DIR, file);
    fs.unlinkSync(fp);
    removed.push(file);
    console.log(`[sandbox] removed state file ${fp}`);
  }

  return removed;
}

/**
 * Persist script source to MongoDB (Render-safe). Scheduled scripts are never pruned.
 */
export async function saveScript({ name, code, scheduled = false, intervalMs = null }) {
  if (!isMongoReady()) return { persisted: false, reason: 'mongodb_unavailable' };

  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > MAX_CODE_BYTES) {
    throw new Error(`Script too large (${bytes} bytes, max ${MAX_CODE_BYTES})`);
  }

  await SandboxScript.findOneAndUpdate(
    { name },
    {
      $set: {
        code,
        scheduled: Boolean(scheduled),
        paused: false,
        intervalMs: scheduled && intervalMs ? intervalMs : null,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  if (!scheduled) await pruneOverflow();
  return { persisted: true };
}

export async function markScheduled(name, intervalMs) {
  if (!isMongoReady()) return;
  await SandboxScript.findOneAndUpdate(
    { name },
    {
      $set: {
        scheduled: true,
        paused: false,
        intervalMs,
        updatedAt: new Date(),
      },
    }
  );
}

export async function markUnscheduled(name) {
  if (!isMongoReady()) return;
  await SandboxScript.findOneAndUpdate(
    { name },
    {
      $set: {
        scheduled: false,
        paused: false,
        intervalMs: null,
        updatedAt: new Date(),
      },
    }
  );
  await pruneOverflow();
}

export async function markPaused(name) {
  if (!isMongoReady()) return;
  await SandboxScript.findOneAndUpdate(
    { name },
    { $set: { paused: true, scheduled: true, updatedAt: new Date() } }
  );
}

export async function markResumed(name) {
  if (!isMongoReady()) return;
  await SandboxScript.findOneAndUpdate(
    { name },
    { $set: { paused: false, scheduled: true, updatedAt: new Date() } }
  );
}

/**
 * Persist a new schedule interval and updated script source (meta banner).
 */
export async function updateScriptInterval(name, intervalMs, code) {
  if (!isMongoReady()) {
    return { ok: false, error: 'mongodb_unavailable' };
  }
  if (!name || !intervalMs || intervalMs <= 0) {
    return { ok: false, error: 'invalid_interval' };
  }
  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > MAX_CODE_BYTES) {
    return { ok: false, error: 'script_too_large' };
  }
  const doc = await SandboxScript.findOneAndUpdate(
    { name },
    {
      $set: {
        code,
        intervalMs,
        scheduled: true,
        updatedAt: new Date(),
      },
    },
    { new: true }
  ).lean();
  if (!doc) return { ok: false, error: 'not_found' };
  return { ok: true, doc };
}

export async function deleteScript(name) {
  const hadDisk = fs.existsSync(scriptPathFor(name));
  const hadLegacy = fs.existsSync(path.join(TOOLS_DIR, `${name}.generated.js`));
  removeFromDisk(name);
  removeLegacyToolFile(name);
  unregisterTool(name);
  const stateRemoved = removeScriptStateFiles(name);
  let hadMongo = false;
  if (isMongoReady()) {
    const res = await SandboxScript.deleteOne({ name });
    hadMongo = res.deletedCount > 0;
  }
  return {
    ok: hadDisk || hadLegacy || hadMongo || stateRemoved.length > 0,
    stateRemoved,
  };
}

export async function getScript(name) {
  if (!isMongoReady()) return null;
  return SandboxScript.findOne({ name }).lean();
}

export async function listScripts() {
  if (!isMongoReady()) return [];
  return SandboxScript.find().sort({ scheduled: -1, updatedAt: -1 }).lean();
}

/**
 * Increment run stats after a sandbox execution.
 * @param {string} name
 * @param {{ exitCode?: number | null, timedOut?: boolean, error?: string | null }} [meta]
 */
export async function recordScriptRun(name, meta = {}) {
  if (!isMongoReady() || !name) return;
  const exitCode = meta.exitCode ?? (meta.error ? 1 : 0);
  const failed = Boolean(meta.error) || Boolean(meta.timedOut) || exitCode !== 0;
  try {
    await SandboxScript.findOneAndUpdate(
      { name },
      {
        $inc: {
          runCount: 1,
          ...(failed ? { failCount: 1 } : {}),
        },
        $set: {
          lastRunAt: new Date(),
          lastExitCode: exitCode,
        },
      }
    );
  } catch (err) {
    console.warn('[sandbox] recordScriptRun:', err.message);
  }
}

export async function listScheduledRecords() {
  if (!isMongoReady()) return [];
  return SandboxScript.find({
    scheduled: true,
    paused: { $ne: true },
    intervalMs: { $gt: 0 },
  }).lean();
}

/** Scripts that are paused (interval kept, timer stopped). */
export async function listPausedRecords() {
  if (!isMongoReady()) return [];
  return SandboxScript.find({
    scheduled: true,
    paused: true,
    intervalMs: { $gt: 0 },
  }).lean();
}

async function pruneOverflow() {
  const count = await SandboxScript.countDocuments();
  if (count <= MAX_SCRIPTS) return;

  const excess = count - MAX_SCRIPTS;
  const victims = await SandboxScript.find({ scheduled: false })
    .sort({ updatedAt: 1 })
    .limit(excess)
    .select('name')
    .lean();

  for (const v of victims) {
    await deleteScript(v.name);
    console.log(`[sandbox] pruned old script: ${v.name}`);
  }
}

export function formatScriptsReply(scripts) {
  if (!scripts.length) {
    return 'No sandbox scripts yet. Open **Automation** and install a vetted script from the script library.';
  }
  const lines = scripts.map((s, i) => {
    const status = s.paused
      ? 'paused'
      : s.scheduled && s.intervalMs
        ? 'scheduled'
        : 'saved';
    const every =
      s.intervalMs > 0
        ? `, every ${
            s.intervalMs >= 3600000 && s.intervalMs % 3600000 === 0
              ? `${s.intervalMs / 3600000}h`
              : s.intervalMs >= 60000 && s.intervalMs % 60000 === 0
                ? `${s.intervalMs / 60000}m`
                : s.intervalMs >= 1000 && s.intervalMs % 1000 === 0
                  ? `${s.intervalMs / 1000}s`
                  : `${s.intervalMs}ms`
          }`
        : '';
    const kb = (Buffer.byteLength(s.code, 'utf8') / 1024).toFixed(1);
    return `${i + 1}. **${s.name}** (${status}${every}, ${kb} KB)`;
  });
  return `Sandbox scripts (${scripts.length}/${MAX_SCRIPTS}):\n\n${lines.join('\n')}\n\nSay **pause name** / **resume name** / **set name every 5 minutes**, or manage them in Automation.`;
}

export function isScriptListRequest(message) {
  const m = message.toLowerCase();
  if (/\b(list|show)\b/.test(m) && /\b(script|scripts)\b/.test(m)) return true;
  if (/\b(my|saved)\b/.test(m) && /\b(script|scripts)\b/.test(m) && /\b(list|show|what)\b/.test(m)) {
    return true;
  }
  return false;
}

export function isScriptDeleteRequest(message) {
  const m = message.toLowerCase();
  if (/\bnotion\b/.test(m) || /\b(mcp|page|database|inbox|gmail)\b/.test(m)) return false;
  if (!/\b(delete|remove)\b/.test(m)) return false;
  return /\bscript\b/.test(m) || /\b(this|it|that)\b/.test(m) || /\b(delete|remove)\s+[a-z][a-z0-9_]+\b/i.test(message);
}

export function extractScriptName(message) {
  const m = message.match(
    /\b(?:delete|remove)\s+(?:the\s+)?(?:script\s+)?["']?([a-z][a-z0-9_-]*)["']?/i
  );
  if (m?.[1]) {
    const raw = m[1].toLowerCase();
    if (!SKIP_NAMES.has(raw)) return raw.replace(/[^a-z0-9_]/g, '_');
  }
  return null;
}

/** Resolve name for "delete this script" — latest saved or legacy .generated.js on disk. */
export async function resolveDeleteScriptName(message) {
  const explicit = extractScriptName(message);
  if (explicit) return explicit;

  if (!/\b(this|it|that)\b/i.test(message)) return null;

  const scripts = await listScripts();
  if (scripts.length === 1) return scripts[0].name;

  try {
    const legacy = fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.generated.js'));
    if (legacy.length === 1) {
      return legacy[0].replace('.generated.js', '');
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function isRunSandboxScriptRequest(message) {
  const t = message.trim();
  if (/^run\s+([a-z][a-z0-9_]+)$/i.test(t)) return t.match(/^run\s+([a-z][a-z0-9_]+)$/i)[1].toLowerCase();
  const m = message.match(/\brun\s+(?:the\s+)?script\s+["']?([a-z][a-z0-9_-]*)["']?/i);
  if (m?.[1]) return m[1].toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return null;
}
