import { callLLM } from './llm.js';
import { getLlmApiKey } from './llm-context.js';
import { retrieveContext, formatContextBlock } from './rag.js';
import { getMemoryContext, learnFromMessage } from './memory.js';
import { getBotName } from './persona.js';
import { listTools, executeTool } from '../tools/registry.js';
import {
  cancel as cancelScheduled,
  formatScheduledReply,
  isScheduledListRequest,
  isScheduledCancelRequest,
  extractScheduledTaskName,
} from '../tools/sandbox/scheduler.js';
import {
  listScripts,
  deleteScript,
  formatScriptsReply,
  isScriptListRequest,
  isScriptDeleteRequest,
  resolveDeleteScriptName,
  isRunSandboxScriptRequest,
  getScript,
  materializeOnDisk,
} from '../tools/sandbox/store.js';
import { runScript } from '../tools/sandbox/runner.js';

/** Valid intent labels returned by classifyIntent */
export const INTENTS = ['CHAT', 'RECALL', 'LEARN', 'TASK', 'SEARCH'];

const CLASSIFY_SYSTEM = `Classify the user message into exactly one intent:

CHAT   - casual conversation, opinions, general knowledge the model already knows
RECALL - asking about past conversation or memory
LEARN  - wants the bot to remember something
TASK   - wants a specific tool action
SEARCH - needs REAL-TIME or CURRENT information including:
         weather, news, prices, sports scores,
         live data, anything that changes day to day,
         finding emails, finding people, company info

IMPORTANT: Any question about current conditions,
today's weather, latest news, current prices = SEARCH
Never classify real-time data questions as CHAT.

Reply with only one word: CHAT, RECALL, LEARN, TASK, or SEARCH`;

/**
 * Fast heuristic classifier when LLM is unavailable or as tie-breaker.
 */
function ruleBasedIntent(message) {
  const m = message.toLowerCase().trim();

  if (/^(hi|hello|hey|yo|sup|howdy|good\s+(morning|afternoon|evening))[!?.]*$/i.test(m)) {
    return 'CHAT';
  }

  if (
    /\b(remember that|don't forget|note that|my name is|save this|learn that)\b/.test(m) ||
    /^remember\b/.test(m.trim())
  ) {
    return 'LEARN';
  }

  if (
    /\b(what did i say|do you remember|recall|last time we|our previous|you said earlier)\b/.test(m)
  ) {
    return 'RECALL';
  }

  if (/\b(calculate|compute|evaluate|summarize this url|summarize http)\b/.test(m)) {
    return 'TASK';
  }

  if (isSelfbuildRequest(message)) {
    return 'TASK';
  }

  if (
    /\b(search for|look up|find information|latest news|current price|weather|sports score|stock price)\b/.test(m) ||
    /\b(today|right now|currently|this week|live)\b/.test(m) ||
    /\b(find email|find contact|company info|recruiter)\b/.test(m) ||
    /^(what is|who is|when did|where is)\b/.test(m.trim())
  ) {
    return 'SEARCH';
  }

  return null;
}

/**
 * Build/run/schedule sandbox scripts via selfbuild.
 */
function isSelfbuildRequest(message) {
  const m = message.toLowerCase();
  if (/\b(build|create|write|make)\b/.test(m) && /\b(tool|script)\b/.test(m)) return true;
  if (/\bcalled\s+[a-z0-9_]+/i.test(message) && /\b(run|execute|test|try|schedule|save)\b/.test(m)) {
    return true;
  }
  if (/\b(save|store)\b/.test(m) && /\bsandbox\b/.test(m)) return true;
  if (/\bevery\s+\d+\s*(ms|second|minute|hour)/i.test(message) && /\b(run|script|schedule)\b/.test(m)) {
    return true;
  }
  return false;
}

function formatSelfbuildResult(result) {
  if (!result || typeof result !== 'object') return String(result ?? 'Done.');
  const parts = [];
  if (result.message) parts.push(result.message);
  if (result.persisted) parts.push('_Stored in MongoDB (survives Render restarts)._');
  else if (result.scriptPath && !result.message?.includes('ran once')) {
    parts.push(`Script path:\n\`${result.scriptPath}\``);
  }
  if (result.stdout?.trim()) parts.push(`**Output:**\n\n${result.stdout.trim()}`);
  if (result.stderr?.trim() && (result.error || result.sandbox?.exitCode !== 0)) {
    parts.push(`Stderr:\n${result.stderr.trim()}`);
  }
  if (result.timeout) parts.push(result.timeout);
  if (result.scheduled?.length) {
    parts.push(`Active schedules: ${result.scheduled.map((s) => s.name).join(', ')}`);
  }
  return parts.length ? parts.join('\n\n') : JSON.stringify(result, null, 2);
}

/**
 * Job posting / recruiter email lookup (uses recruiter tool).
 */
function isRecruiterEmailRequest(message) {
  const m = message.toLowerCase();

  if (
    /\b(recruiter|hiring manager|talent acquisition|hr contact|recruiting)\b/.test(m) &&
    /\b(email|e-mail|contact|address|reach)\b/.test(m)
  ) {
    return true;
  }

  if (/\b(job posting|job listing|job description|this role|this position)\b/.test(m)) {
    return true;
  }

  if (
    message.length > 180 &&
    /\b(requirements|qualifications|responsibilities|apply now|we are hiring|job title)\b/.test(m)
  ) {
    return true;
  }

  return false;
}

function parseIntentLabel(raw) {
  const upper = raw.trim().toUpperCase();
  for (const intent of INTENTS) {
    if (upper.includes(intent)) return intent;
  }
  return 'CHAT';
}

/**
 * Classify user message intent using a lightweight non-streaming Qwen call.
 */
export async function classifyIntent(message) {
  const rule = ruleBasedIntent(message);
  if (rule) return rule;

  // Skip extra LLM call for short casual messages (reduces free-tier rate limits)
  const trimmed = message.trim();
  if (
    trimmed.length < 120 &&
    !/\b(search|calculate|compute|remember|recall|summarize|weather|news|price|today|current|latest|email|https?:\/\/)\b/i.test(trimmed)
  ) {
    return 'CHAT';
  }

  try {
    const raw = await callLLM(
      [{ role: 'user', content: message }],
      CLASSIFY_SYSTEM,
      { stream: false }
    );
    return parseIntentLabel(raw);
  } catch (err) {
    console.warn('[intent] classifyIntent LLM failed:', err.message);
    return ruleBasedIntent(message) || 'CHAT';
  }
}

function buildMessages(history, message) {
  return [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];
}

/**
 * Prefix any handler system prompt with graph memory from MongoDB.
 */
async function withMemory(basePrompt, message) {
  const memoryBlock = await getMemoryContext(message);
  return `${basePrompt}

Known facts about the user (graph memory):
${memoryBlock}`;
}

/**
 * CHAT — general conversation.
 */
async function handleChat(message, history, options = {}) {
  const systemPrompt = await withMemory(
    `You are ${getBotName()}. Be concise, accurate, and friendly. Speak as their personal assistant — never as Qwen, Alibaba, or another vendor model.`,
    message
  );
  const reply = await callLLM(buildMessages(history, message), systemPrompt, {
    stream: true,
    onToken: options.onToken,
  });
  return { intent: 'CHAT', reply, toolUsed: null };
}

/**
 * RECALL — vector RAG + session history + graph memory.
 */
async function handleRecall(message, history, options = {}) {
  const sessionId = options.sessionId || 'default';
  const ragHits = await retrieveContext(message, sessionId, 5);
  const ragBlock = formatContextBlock(ragHits);

  const historyBlock =
    history.length > 0
      ? history.map((m) => `${m.role}: ${m.content}`).join('\n')
      : '(no prior messages in this request history)';

  const systemPrompt = await withMemory(
    `You are ${getBotName()} helping the user recall past conversations.
Use the relevant memories from vector search and the recent session history below.
If information is missing, say so honestly.

Relevant memories (vector search):
${ragBlock}

Recent session history:
${historyBlock}`,
    message
  );

  const reply = await callLLM(buildMessages(history, message), systemPrompt, {
    stream: true,
    onToken: options.onToken,
  });
  return { intent: 'RECALL', reply, toolUsed: null };
}

/**
 * LEARN — extract entities and persist to graph memory.
 */
async function handleLearn(message, history, options = {}) {
  await learnFromMessage(message);

  const systemPrompt = await withMemory(
    `You are ${getBotName()}. The user wants you to remember a fact.
Acknowledge what you will remember in one short sentence, then confirm the fact clearly.
Do not invent details they did not provide.`,
    message
  );

  const reply = await callLLM(buildMessages(history, message), systemPrompt, {
    stream: true,
    onToken: options.onToken,
  });
  return { intent: 'LEARN', reply, toolUsed: null, learned: message };
}

/**
 * Parse JSON tool picker output from LLM.
 */
function parseToolPick(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonStr);
}

/**
 * Ask Qwen which tool to run and with what input string.
 */
async function pickTool(message) {
  const available = listTools();
  if (!available.length) throw new Error('No tools registered');

  const catalog = available.map((t) => `- ${t.name}: ${t.description}`).join('\n');

  const raw = await callLLM(
    [{ role: 'user', content: message }],
    `You are a tool router. Available tools:\n${catalog}\n\nPick the best tool for the user request.
Reply with ONLY JSON: {"tool":"tool_name","input":"string passed to the tool"}`,
    { stream: false }
  );

  const pick = parseToolPick(raw);
  if (!pick?.tool) throw new Error('Tool picker returned invalid JSON');
  return { tool: pick.tool, input: String(pick.input ?? message) };
}

/**
 * Run a tool and synthesize a natural-language reply.
 */
async function runToolAndReply(message, history, options, toolName, toolInput) {
  const { result } = await executeTool(toolName, toolInput, {
    onToken: options.onToken,
  });

  if ((toolName === 'recruiter' || toolName === 'websearch') && result?.answer) {
    return { intent: 'TASK', reply: result.answer, toolUsed: toolName, toolResult: result };
  }

  const resultText =
    typeof result === 'string' ? result : JSON.stringify(result, null, 2);

  const systemPrompt = await withMemory(
    `You are ${getBotName()}. A tool was executed successfully.
Tool: ${toolName}
Result:
${resultText}

Summarize this result clearly for the user.`,
    message
  );

  const reply = await callLLM(buildMessages(history, message), systemPrompt, {
    stream: true,
    onToken: options.onToken,
  });

  return { intent: 'TASK', reply, toolUsed: toolName, toolResult: result };
}

/**
 * Generate, save, and optionally run sandbox scripts (selfbuild).
 */
async function handleSelfbuild(message, history, options = {}) {
  const { result } = await executeTool('selfbuild', message);
  const reply = formatSelfbuildResult(result);
  if (options.onToken) options.onToken(reply);
  return { intent: 'TASK', reply, toolUsed: 'selfbuild', toolResult: result };
}

/**
 * List scripts saved in MongoDB.
 */
async function handleScriptList(_message, _history, options = {}) {
  const scripts = await listScripts();
  const reply = formatScriptsReply(scripts);
  if (options.onToken) options.onToken(reply);
  return { intent: 'TASK', reply, toolUsed: 'sandbox' };
}

/**
 * Delete a saved script from MongoDB, sandbox disk, and legacy .generated.js.
 */
async function handleScriptDelete(name, _message, _history, options = {}) {
  cancelScheduled(name);
  const { ok, stateRemoved } = await deleteScript(name);
  let reply = ok
    ? `Deleted script **${name}** (sandbox script + MongoDB + legacy tool file).`
    : `No saved script named **${name}**.`;
  if (stateRemoved?.length) {
    reply += `\nRemoved state files: ${stateRemoved.join(', ')}`;
  }
  if (options.onToken) options.onToken(reply);
  return { intent: 'TASK', reply, toolUsed: 'sandbox', deleted: ok, stateRemoved };
}

/**
 * Run a script already saved in sandbox (not the old .generated.js tool path).
 */
async function handleRunSandboxScript(name, _message, _history, options = {}) {
  const doc = await getScript(name);
  if (!doc?.code) {
    const reply = `No sandbox script named **${name}**. Build it first with "build a script called ${name} … save in sandbox".`;
    if (options.onToken) options.onToken(reply);
    return { intent: 'TASK', reply, toolUsed: 'sandbox' };
  }
  const scriptPath = materializeOnDisk(name, doc.code);
  const runResult = await runScript(scriptPath);
  const parts = [`Ran **${name}** from sandbox.`];
  if (runResult.stdout?.trim()) parts.push(`Output:\n${runResult.stdout.trim()}`);
  if (runResult.exitCode !== 0 && runResult.stderr?.trim()) {
    parts.push(`Stderr:\n${runResult.stderr.trim()}`);
  }
  const reply = parts.join('\n\n');
  if (options.onToken) options.onToken(reply);
  return { intent: 'TASK', reply, toolUsed: 'sandbox', sandbox: runResult };
}

/**
 * List persisted / in-memory scheduled sandbox scripts.
 */
async function handleScheduledList(message, history, options = {}) {
  const reply = formatScheduledReply();
  if (options.onToken) options.onToken(reply);
  return { intent: 'TASK', reply, toolUsed: 'scheduler' };
}

/**
 * Cancel a scheduled sandbox script by name.
 */
async function handleScheduledCancel(name, message, history, options = {}) {
  const ok = cancelScheduled(name);
  let reply;
  if (ok) {
    reply = `Stopped scheduled task **${name}**.`;
  } else {
    reply = `No scheduled task named **${name}** is running. Use "show scheduled tasks" to list active jobs.`;
  }
  if (options.onToken) options.onToken(reply);
  return { intent: 'TASK', reply, toolUsed: 'scheduler', cancelled: ok, taskName: name };
}

/**
 * TASK — Qwen picks a tool from registry and executes it.
 */
async function handleTask(message, history, options = {}) {
  try {
    if (isSelfbuildRequest(message)) {
      return handleSelfbuild(message, history, options);
    }

    if (isRecruiterEmailRequest(message)) {
      return handleRecruiterEmail(message, history, options);
    }

    const { tool, input } = await pickTool(message);
    return runToolAndReply(message, history, options, tool, input);
  } catch (err) {
    const reply = `Task failed: ${err.message}`;
    if (options.onToken) options.onToken(reply);
    return { intent: 'TASK', reply, toolUsed: null };
  }
}

/**
 * SEARCH — websearch tool (fetches snippets + LLM summary inside tool).
 */
async function handleSearch(message, history, options = {}) {
  try {
    const { result } = await executeTool('websearch', message, {
      onToken: options.onToken,
    });
    const reply = result.answer || result.summary || 'No search results found.';
    return { intent: 'SEARCH', reply, toolUsed: 'websearch' };
  } catch (err) {
    const reply = `Search failed: ${err.message}`;
    if (options.onToken) options.onToken(reply);
    return { intent: 'SEARCH', reply, toolUsed: 'websearch' };
  }
}

/**
 * RECRUITER — find hiring contacts from a job posting (web + optional Hunter.io).
 */
async function handleRecruiterEmail(message, history, options = {}) {
  try {
    const { result } = await executeTool('recruiter', message, {
      onToken: options.onToken,
    });
    const reply = result.answer || 'No recruiter emails found.';
    return { intent: 'SEARCH', reply, toolUsed: 'recruiter', toolResult: result };
  } catch (err) {
    const reply = `Recruiter lookup failed: ${err.message}`;
    if (options.onToken) options.onToken(reply);
    return { intent: 'SEARCH', reply, toolUsed: 'recruiter' };
  }
}

/**
 * Route a user message to the correct handler based on classified intent.
 * @param {string} message
 * @param {Array<{ role: string, content: string }>} history
 * @param {{ sessionId?: string, onToken?: (chunk: string) => void, stream?: boolean, task?: object }} [options]
 *   `task` is set by {@link runChatTurn} (core/runtime.js) for execution lifecycle / future hooks.
 */
export async function routeMessage(message, history = [], options = {}) {
  if (!getLlmApiKey()) {
    const reply =
      'OpenRouter is not configured. Add your API key in Settings → BYOK, or set OPENROUTER_API_KEY on the server.';
    if (options.onToken) options.onToken(reply);
    return { intent: 'CHAT', reply, toolUsed: null };
  }

  if (isRecruiterEmailRequest(message)) {
    console.log(`[intent] RECRUITER — session ${options.sessionId || 'none'}`);
    return handleRecruiterEmail(message, history, options);
  }

  if (isScriptListRequest(message)) {
    console.log(`[intent] SCRIPT_LIST — session ${options.sessionId || 'none'}`);
    return handleScriptList(message, history, options);
  }

  const runScriptName = isRunSandboxScriptRequest(message);
  if (runScriptName) {
    console.log(`[intent] SANDBOX_RUN ${runScriptName} — session ${options.sessionId || 'none'}`);
    return handleRunSandboxScript(runScriptName, message, history, options);
  }

  if (isScriptDeleteRequest(message)) {
    const scriptName = await resolveDeleteScriptName(message);
    if (scriptName) {
      console.log(`[intent] SCRIPT_DELETE ${scriptName} — session ${options.sessionId || 'none'}`);
      return handleScriptDelete(scriptName, message, history, options);
    }
  }

  if (isScheduledListRequest(message)) {
    console.log(`[intent] SCHEDULED_LIST — session ${options.sessionId || 'none'}`);
    return handleScheduledList(message, history, options);
  }

  if (isScheduledCancelRequest(message)) {
    const taskName = extractScheduledTaskName(message);
    if (taskName) {
      console.log(`[intent] SCHEDULED_CANCEL ${taskName} — session ${options.sessionId || 'none'}`);
      return handleScheduledCancel(taskName, message, history, options);
    }
  }

  if (isSelfbuildRequest(message)) {
    console.log(`[intent] SELFBUILD — session ${options.sessionId || 'none'}`);
    return handleSelfbuild(message, history, options);
  }

  const intent = await classifyIntent(message);
  console.log(`[intent] ${intent} — session ${options.sessionId || 'none'}`);

  switch (intent) {
    case 'RECALL':
      return handleRecall(message, history, options);
    case 'LEARN':
      return handleLearn(message, history, options);
    case 'TASK':
      return handleTask(message, history, options);
    case 'SEARCH':
      return handleSearch(message, history, options);
    case 'CHAT':
    default:
      return handleChat(message, history, options);
  }
}
