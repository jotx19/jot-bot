import { randomUUID } from 'crypto';

/** Lifecycle for one user turn / execution unit (chat, tool, etc.). */
export const TASK_STATUS = Object.freeze({
  CREATED: 'CREATED',
  PLANNING: 'PLANNING',
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
  RETRYING: 'RETRYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const TERMINAL = new Set([
  TASK_STATUS.COMPLETED,
  TASK_STATUS.FAILED,
  TASK_STATUS.CANCELLED,
]);

function nowIso() {
  return new Date().toISOString();
}

function preview(text, max = 160) {
  if (text == null) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Create a new in-memory task record for one routed turn.
 * @param {{ sessionId?: string | null, input: string, parentTaskId?: string | null, channel?: string }} opts
 */
export function createTaskRecord(opts = {}) {
  const { sessionId = null, input = '', parentTaskId = null, channel = 'web' } = opts;
  const t = nowIso();
  return {
    id: randomUUID(),
    status: TASK_STATUS.CREATED,
    createdAt: t,
    updatedAt: t,
    sessionId,
    channel: typeof channel === 'string' ? channel : 'web',
    inputPreview: preview(input),
    retries: 0,
    toolCalls: [],
    failures: [],
    parentTaskId: parentTaskId || null,
    childTaskIds: [],
    meta: {},
  };
}

export function taskSetStatus(task, status) {
  if (!task || !status) return;
  if (TERMINAL.has(task.status)) return;
  task.status = status;
  task.updatedAt = nowIso();
}

export function taskIncrementRetries(task) {
  if (!task) return;
  task.retries = (task.retries || 0) + 1;
  task.updatedAt = nowIso();
}

/**
 * @param {object} task
 * @param {{ name: string, detail?: string }} call
 */
export function taskRecordToolCall(task, call) {
  if (!task || !call?.name) return;
  task.toolCalls.push({
    name: call.name,
    at: nowIso(),
    ...(call.detail ? { detail: String(call.detail).slice(0, 2000) } : {}),
  });
  task.updatedAt = nowIso();
}

export function taskRecordFailure(task, err) {
  if (!task) return;
  const message = err?.message != null ? String(err.message) : String(err);
  task.failures.push({ message: message.slice(0, 2000), at: nowIso() });
  task.updatedAt = nowIso();
}

/**
 * Link a child task id (reserved for future sub-runs).
 */
export function taskAddChild(task, childId) {
  if (!task || !childId) return;
  if (!task.childTaskIds.includes(childId)) task.childTaskIds.push(childId);
  task.updatedAt = nowIso();
}

/** Safe JSON for API / logs (no large payloads; no provider/billing error details). */
export function taskToPublicJSON(task) {
  if (!task) return null;
  return {
    id: task.id,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    retries: task.retries,
    toolCalls: task.toolCalls,
    failures: (task.failures || []).map((f) => ({
      at: f.at,
      message: 'Internal server error.',
    })),
    parentTaskId: task.parentTaskId,
    childTaskIds: task.childTaskIds,
    channel: task.channel,
    inputPreview: task.inputPreview,
  };
}
