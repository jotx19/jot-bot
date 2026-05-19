import { routeMessage } from './intent.js';
import {
  createTaskRecord,
  taskSetStatus,
  TASK_STATUS,
  taskRecordToolCall,
  taskRecordFailure,
  taskToPublicJSON,
} from './state.js';

/**
 * Execute one user message through intent routing with explicit task lifecycle.
 * This is the single entry point for “one turn” from transports (web SSE, REST, Discord).
 *
 * @param {{
 *   message: string,
 *   history?: Array,
 *   sessionId?: string | null,
 *   channel?: string,
 *   parentTaskId?: string | null,
 *   onToken?: (chunk: string) => void,
 * }} params
 * @returns {Promise<{ ok: true, task: object, result: object } | { ok: false, task: object, error: string }>}
 */
export async function runChatTurn(params) {
  const {
    message,
    history = [],
    sessionId = null,
    channel = 'web',
    parentTaskId = null,
    onToken,
  } = params;

  const task = createTaskRecord({
    sessionId,
    input: message,
    parentTaskId,
    channel,
  });

  try {
    taskSetStatus(task, TASK_STATUS.PLANNING);
    taskSetStatus(task, TASK_STATUS.RUNNING);

    const result = await routeMessage(message, history, {
      sessionId,
      onToken,
      task,
    });

    if (result?.toolUsed) {
      taskRecordToolCall(task, { name: result.toolUsed });
    }

    taskSetStatus(task, TASK_STATUS.COMPLETED);
    console.log(
      `[runtime] task=${task.id} status=${task.status} channel=${task.channel} toolCalls=${task.toolCalls.length}`
    );
    return {
      ok: true,
      task: taskToPublicJSON(task),
      result,
    };
  } catch (err) {
    const turnError = err?.message || 'Unknown error';
    taskRecordFailure(task, err);
    taskSetStatus(task, TASK_STATUS.FAILED);
    console.warn(`[runtime] task=${task.id} status=${task.status} channel=${task.channel} — ${turnError}`);
    return {
      ok: false,
      task: taskToPublicJSON(task),
      error: turnError,
    };
  }
}
