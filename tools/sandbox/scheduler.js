import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runScript } from './runner.js';
import {
  materializeOnDisk,
  markScheduled,
  markUnscheduled,
  markPaused,
  markResumed,
  listScheduledRecords,
  listPausedRecords,
  getScript,
  updateScriptInterval,
} from './store.js';
import { notifySchedulerRun } from './notify.js';
import { applyAutomationMeta, readAutomationMeta } from './library.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, 'state');
const STATE_FILE = path.join(STATE_DIR, 'scheduled.json');

const schedules = new Map();
/** Paused jobs keep path + interval so resume works without Mongo. */
const pausedJobs = new Map();
let defaultRunFn = runScript;

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

/** File fallback when MongoDB is unavailable (local dev only). */
function persistFile() {
  ensureStateDir();
  const data = [
    ...[...schedules.entries()].map(([name, e]) => ({
      name,
      scriptPath: e.scriptPath,
      intervalMs: e.intervalMs,
      paused: false,
    })),
    ...[...pausedJobs.entries()].map(([name, e]) => ({
      name,
      scriptPath: e.scriptPath,
      intervalMs: e.intervalMs,
      paused: true,
    })),
  ];
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

function loadFileFallback() {
  if (!fs.existsSync(STATE_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function startInterval(name, scriptPath, intervalMs, runFn) {
  const entry = { scriptPath, intervalMs, lastRun: null, intervalId: null };

  const tick = async () => {
    entry.lastRun = new Date().toISOString();
    try {
      const result = await runFn(scriptPath);
      entry.lastResult = {
        exitCode: result?.exitCode ?? null,
        timedOut: Boolean(result?.timedOut),
        stdout: String(result?.stdout || '').slice(0, 4000),
        stderr: String(result?.stderr || '').slice(0, 2000),
        at: entry.lastRun,
      };
      notifySchedulerRun(name, result).catch((err) => {
        console.warn(`[scheduler] notify ${name}:`, err.message);
      });
    } catch (err) {
      console.warn(`[scheduler] ${name} run failed:`, err.message);
      entry.lastResult = { error: err.message, at: entry.lastRun };
      notifySchedulerRun(name, null, err.message).catch((notifyErr) => {
        console.warn(`[scheduler] notify ${name}:`, notifyErr.message);
      });
    }
  };

  tick();
  entry.intervalId = setInterval(tick, intervalMs);
  schedules.set(name, entry);
}

export function schedule(name, scriptPath, intervalMs, runFn = defaultRunFn) {
  cancel(name, { persist: false });
  pausedJobs.delete(name);
  startInterval(name, scriptPath, intervalMs, runFn);
  markScheduled(name, intervalMs).catch((err) => {
    console.warn('[scheduler] markScheduled:', err.message);
  });
  persistFile();
  return schedules.get(name).intervalId;
}

export function cancel(name, opts = {}) {
  const running = schedules.get(name);
  const paused = pausedJobs.get(name);
  if (!running && !paused) return false;
  if (running) {
    clearInterval(running.intervalId);
    schedules.delete(name);
  }
  pausedJobs.delete(name);
  if (opts.persist !== false) {
    markUnscheduled(name).catch((err) => {
      console.warn('[scheduler] markUnscheduled:', err.message);
    });
    persistFile();
  }
  return true;
}

/**
 * Stop ticks but keep interval so the job can be resumed from Automation.
 */
export function pause(name) {
  const entry = schedules.get(name);
  if (entry) {
    clearInterval(entry.intervalId);
    schedules.delete(name);
    pausedJobs.set(name, {
      scriptPath: entry.scriptPath,
      intervalMs: entry.intervalMs,
      lastRun: entry.lastRun || null,
      lastResult: entry.lastResult || null,
    });
    markPaused(name).catch((err) => {
      console.warn('[scheduler] markPaused:', err.message);
    });
    persistFile();
    return true;
  }
  return false;
}

/** Mark a script paused without starting a tick (e.g. already stopped in memory). */
export function pauseStored(name, scriptPath, intervalMs) {
  if (!name || !scriptPath || !intervalMs) return false;
  const running = schedules.get(name);
  if (running) {
    clearInterval(running.intervalId);
    schedules.delete(name);
  }
  pausedJobs.set(name, {
    scriptPath,
    intervalMs,
    lastRun: running?.lastRun || null,
    lastResult: running?.lastResult || null,
  });
  markPaused(name).catch((err) => {
    console.warn('[scheduler] markPaused:', err.message);
  });
  persistFile();
  return true;
}

/**
 * Resume a paused schedule (or a Mongo-paused script after restart).
 */
export async function resume(name, runFn = defaultRunFn) {
  const local = pausedJobs.get(name);
  if (local?.scriptPath && local.intervalMs) {
    pausedJobs.delete(name);
    startInterval(name, local.scriptPath, local.intervalMs, runFn);
    markResumed(name).catch((err) => {
      console.warn('[scheduler] markResumed:', err.message);
    });
    persistFile();
    return true;
  }

  if (schedules.has(name)) return true;

  const doc = await getScript(name);
  if (!doc?.code || !doc.intervalMs || doc.intervalMs <= 0) return false;
  const scriptPath = materializeOnDisk(name, doc.code);
  pausedJobs.delete(name);
  startInterval(name, scriptPath, doc.intervalMs, runFn);
  markResumed(name).catch((err) => {
    console.warn('[scheduler] markResumed:', err.message);
  });
  persistFile();
  return true;
}

const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Change a sandbox script's schedule interval and rewrite the meta banner in source.
 * Keeps paused vs running; updates Mongo + on-disk script.
 */
export async function setScriptInterval(name, intervalMs, runFn = defaultRunFn) {
  const key = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  const next = Number(intervalMs);
  if (!key) return { ok: false, error: 'missing_name' };
  if (!Number.isFinite(next) || next < MIN_INTERVAL_MS) {
    return {
      ok: false,
      error: 'invalid_interval',
      message: `Interval must be at least ${formatInterval(MIN_INTERVAL_MS)}.`,
    };
  }
  if (next > MAX_INTERVAL_MS) {
    return {
      ok: false,
      error: 'invalid_interval',
      message: `Interval must be at most ${formatInterval(MAX_INTERVAL_MS)}.`,
    };
  }

  const doc = await getScript(key);
  if (!doc?.code) return { ok: false, error: 'not_found' };

  const meta = readAutomationMeta(doc.code);
  const code = applyAutomationMeta(doc.code, {
    libraryId: meta.libraryId || key,
    name: meta.name || key,
    intervalMs: next,
  });

  const wasPaused = Boolean(doc.paused) || pausedJobs.has(key);
  const wasRunning = schedules.has(key);

  cancel(key, { persist: false });
  pausedJobs.delete(key);

  const saved = await updateScriptInterval(key, next, code);
  if (!saved.ok) return { ok: false, error: saved.error || 'save_failed' };

  const scriptPath = materializeOnDisk(key, code);

  if (wasPaused) {
    pausedJobs.set(key, {
      scriptPath,
      intervalMs: next,
      lastRun: null,
      lastResult: null,
    });
    await markPaused(key).catch(() => {});
  } else {
    startInterval(key, scriptPath, next, runFn);
    await markScheduled(key, next).catch(() => {});
  }

  persistFile();
  return {
    ok: true,
    name: key,
    intervalMs: next,
    paused: wasPaused,
    scheduled: true,
    wasRunning,
  };
}

export function listScheduled() {
  return [
    ...[...schedules.entries()].map(([name, e]) => ({
      name,
      scriptPath: e.scriptPath,
      intervalMs: e.intervalMs,
      lastRun: e.lastRun,
      lastResult: e.lastResult || null,
      paused: false,
    })),
    ...[...pausedJobs.entries()].map(([name, e]) => ({
      name,
      scriptPath: e.scriptPath,
      intervalMs: e.intervalMs,
      lastRun: e.lastRun,
      lastResult: e.lastResult || null,
      paused: true,
    })),
  ];
}

export function formatInterval(ms) {
  if (ms >= 3600000 && ms % 3600000 === 0) return `${ms / 3600000} hour(s)`;
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000} minute(s)`;
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000} second(s)`;
  return `${ms}ms`;
}

export function formatScheduledReply() {
  const items = listScheduled();
  if (!items.length) return 'No scheduled tasks are currently running.';
  const lines = items.map(
    (t, i) =>
      `${i + 1}. **${t.name}** — every ${formatInterval(t.intervalMs)}` +
      (t.lastRun ? ` (last run: ${t.lastRun})` : '')
  );
  return `Scheduled tasks (${items.length}):\n\n${lines.join('\n')}`;
}

export function isScheduledListRequest(message) {
  const m = message.toLowerCase();
  if (/\bshow me all running scheduled tasks\b/.test(m)) return true;
  return (
    /\b(list|show|what are|display|see)\b/.test(m) &&
    /\b(scheduled|schedule|running)\b/.test(m) &&
    /\b(task|job|script)s?\b/.test(m)
  );
}

export function isScheduledCancelRequest(message) {
  return (
    /\b(stop|cancel|kill|unschedule|disable|end)\b/i.test(message) &&
    (/\b(scheduled|schedule|task|job|script|cron)\b/i.test(message) ||
      /\b(?:stop|cancel|kill)\s+(?:the\s+)?[a-z][a-z0-9_-]+\b/i.test(message))
  );
}

export function isScheduledPauseRequest(message) {
  const m = message.toLowerCase();
  return (
    /\bpause\b/.test(m) &&
    (/\b(script|schedule|scheduled|task|job|automation)\b/.test(m) ||
      /\bpause\s+(?:the\s+)?[a-z][a-z0-9_-]+\b/i.test(message))
  );
}

export function isScheduledResumeRequest(message) {
  const m = message.toLowerCase();
  return (
    /\b(resume|unpause|continue)\b/.test(m) &&
    (/\b(script|schedule|scheduled|task|job|automation)\b/.test(m) ||
      /\b(?:resume|unpause|continue)\s+(?:the\s+)?[a-z][a-z0-9_-]+\b/i.test(message))
  );
}

export function extractPauseResumeScriptName(message) {
  const patterns = [
    /\b(?:pause|resume|unpause|continue)\s+(?:the\s+)?(?:scheduled\s+)?(?:script\s+)?["']?([a-z][a-z0-9_-]*)["']?/i,
  ];
  for (const p of patterns) {
    const m = message.match(p);
    if (m?.[1]) {
      const raw = m[1].toLowerCase();
      if (
        !['the', 'scheduled', 'task', 'job', 'script', 'running', 'my', 'automation'].includes(
          raw
        )
      ) {
        return raw.replace(/[^a-z0-9_]/g, '_');
      }
    }
  }
  return null;
}

const INTERVAL_UNIT_MS = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

/**
 * Parse "every 5 minutes" / "30m" / "1 hour" style intervals from chat.
 */
export function parseIntervalMsFromMessage(message) {
  const text = String(message || '');
  const patterns = [
    /\bevery\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/i,
    /\b(?:interval|schedule)\s*(?:to|of|=|:)?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/i,
    /\bto\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const n = Number(m[1]);
    const unit = String(m[2] || '').toLowerCase();
    const mult = INTERVAL_UNIT_MS[unit];
    if (!Number.isFinite(n) || n <= 0 || !mult) continue;
    return Math.round(n * mult);
  }
  return null;
}

export function isScriptIntervalChangeRequest(message) {
  const m = String(message || '').toLowerCase();
  if (parseIntervalMsFromMessage(message) == null) return false;
  if (
    /\b(change|set|update|reschedule|adjust)\b/.test(m) &&
    /\b(interval|schedule|frequency)\b/.test(m)
  ) {
    return true;
  }
  if (/\breschedule\b/.test(m)) return true;
  if (/\bmake\b/.test(m) && /\brun\s+every\b/.test(m)) return true;
  if (
    /\b(set|change|update)\b/.test(m) &&
    /\bevery\s+\d+/.test(m) &&
    /\b[a-z][a-z0-9_-]{2,}\b/.test(m)
  ) {
    return true;
  }
  return false;
}

export function extractIntervalChangeScriptName(message) {
  const patterns = [
    /\b(?:change|set|update|adjust)\s+(?:the\s+)?(?:interval|schedule|frequency)\s+(?:of|for)\s+(?:the\s+)?(?:script\s+)?["']?([a-z][a-z0-9_-]+)["']?/i,
    /\b(?:change|set|update|adjust)\s+(?:the\s+)?(?:script\s+)?["']?([a-z][a-z0-9_-]+)["']?\s+(?:interval|schedule|frequency)\b/i,
    /\breschedule\s+(?:the\s+)?(?:script\s+)?["']?([a-z][a-z0-9_-]+)["']?/i,
    /\bmake\s+["']?([a-z][a-z0-9_-]+)["']?\s+run\s+every\b/i,
    /\b(?:set|change|update)\s+["']?([a-z][a-z0-9_-]+)["']?\s+(?:to\s+)?every\b/i,
    /\b(?:interval|schedule)\s+(?:of|for)\s+["']?([a-z][a-z0-9_-]+)["']?/i,
  ];
  const skip = new Set([
    'the',
    'scheduled',
    'task',
    'job',
    'script',
    'running',
    'my',
    'automation',
    'interval',
    'schedule',
    'frequency',
    'every',
    'to',
    'for',
    'of',
  ]);
  for (const p of patterns) {
    const m = message.match(p);
    if (m?.[1]) {
      const raw = m[1].toLowerCase();
      if (!skip.has(raw)) return raw.replace(/[^a-z0-9_]/g, '_');
    }
  }
  return null;
}

export function extractScheduledTaskName(message) {
  const patterns = [
    /\b(?:stop|cancel|kill|end|unschedule|disable)\s+(?:the\s+)?(?:scheduled\s+(?:task\s+)?)?["']?([a-z][a-z0-9_-]*)["']?/i,
    /\b(?:stop|cancel)\s+(?:the\s+)?([a-z][a-z0-9_-]+)(?:\s+task|\s+job|\s+script)?\s*$/i,
  ];
  for (const p of patterns) {
    const m = message.match(p);
    if (m?.[1]) {
      const raw = m[1].toLowerCase();
      if (!['the', 'scheduled', 'task', 'job', 'script', 'running', 'my'].includes(raw)) {
        return raw.replace(/[^a-z0-9_]/g, '_');
      }
    }
  }
  return null;
}

export async function restoreScheduled(runFn = defaultRunFn) {
  let restored = 0;
  let pausedRestored = 0;
  const fromDb = await listScheduledRecords();

  for (const item of fromDb) {
    if (!item?.name || !item.code || !item.intervalMs) continue;
    try {
      const scriptPath = materializeOnDisk(item.name, item.code);
      startInterval(item.name, scriptPath, item.intervalMs, runFn);
      restored++;
    } catch (err) {
      console.warn(`[scheduler] skip ${item.name}:`, err.message);
    }
  }

  // Keep paused jobs in memory so resume works after restart without re-query.
  const pausedDocs = await listPausedRecords();
  for (const item of pausedDocs) {
    if (!item?.name || !item.code || !item.intervalMs) continue;
    try {
      const scriptPath = materializeOnDisk(item.name, item.code);
      pausedJobs.set(item.name, {
        scriptPath,
        intervalMs: item.intervalMs,
        lastRun: null,
        lastResult: null,
      });
      pausedRestored++;
    } catch (err) {
      console.warn(`[scheduler] skip paused ${item.name}:`, err.message);
    }
  }

  if (!fromDb.length && !pausedRestored) {
    const saved = loadFileFallback();
    for (const item of saved) {
      if (!item?.name || !item.scriptPath || !item.intervalMs) continue;
      if (!fs.existsSync(item.scriptPath)) continue;
      if (item.paused) {
        pausedJobs.set(item.name, {
          scriptPath: item.scriptPath,
          intervalMs: item.intervalMs,
          lastRun: null,
          lastResult: null,
        });
        pausedRestored++;
      } else {
        startInterval(item.name, item.scriptPath, item.intervalMs, runFn);
        restored++;
      }
    }
  }

  persistFile();
  console.log(
    `[scheduler] restored ${restored} scheduled task(s)` +
      (pausedRestored ? `, ${pausedRestored} paused` : '')
  );
  return restored;
}
