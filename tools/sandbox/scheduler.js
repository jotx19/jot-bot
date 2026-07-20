import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runScript } from './runner.js';
import {
  materializeOnDisk,
  markScheduled,
  markUnscheduled,
  listScheduledRecords,
} from './store.js';
import { notifySchedulerRun } from './notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, 'state');
const STATE_FILE = path.join(STATE_DIR, 'scheduled.json');

const schedules = new Map();
let defaultRunFn = runScript;

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

/** File fallback when MongoDB is unavailable (local dev only). */
function persistFile() {
  ensureStateDir();
  const data = [...schedules.entries()].map(([name, e]) => ({
    name,
    scriptPath: e.scriptPath,
    intervalMs: e.intervalMs,
  }));
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
  startInterval(name, scriptPath, intervalMs, runFn);
  markScheduled(name, intervalMs).catch((err) => {
    console.warn('[scheduler] markScheduled:', err.message);
  });
  persistFile();
  return schedules.get(name).intervalId;
}

export function cancel(name, opts = {}) {
  const entry = schedules.get(name);
  if (!entry) return false;
  clearInterval(entry.intervalId);
  schedules.delete(name);
  if (opts.persist !== false) {
    markUnscheduled(name).catch((err) => {
      console.warn('[scheduler] markUnscheduled:', err.message);
    });
    persistFile();
  }
  return true;
}

export function listScheduled() {
  return [...schedules.entries()].map(([name, e]) => ({
    name,
    scriptPath: e.scriptPath,
    intervalMs: e.intervalMs,
    lastRun: e.lastRun,
    lastResult: e.lastResult || null,
  }));
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

  if (!fromDb.length) {
    const saved = loadFileFallback();
    for (const item of saved) {
      if (!item?.name || !item.scriptPath || !item.intervalMs) continue;
      if (!fs.existsSync(item.scriptPath)) continue;
      startInterval(item.name, item.scriptPath, item.intervalMs, runFn);
      restored++;
    }
  }

  persistFile();
  console.log(`[scheduler] restored ${restored} scheduled task(s)`);
  return restored;
}
