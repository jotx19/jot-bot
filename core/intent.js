import { callLLM } from './llm.js';
import { getLlmApiKey } from './llm-context.js';
import { retrieveContext, formatContextBlock } from './rag.js';
import { getMemoryContext, learnFromMessage } from './memory.js';
import { getBotName } from './persona.js';
import { listTools, executeTool } from '../tools/registry.js';
import { logAndPublicError, PUBLIC_ERROR } from './errors.js';
import {
  listMcpToolsForRequest,
  callMcpToolForRequest,
  isMcpToolName,
  hasEnabledMcpServers,
  hasEnabledMcpServersAsync,
  isLikelyMcpTaskRequest,
  getOrCreateMcpSessionAsync,
  tryDirectMcpPick,
  fallbackMcpPick,
  isNotionCreatePageMessage,
  notionCreatePage,
  isNotionAppendToPageMessage,
  notionAppendToPage,
  isNotionDeletePageMessage,
  notionDeletePage,
} from './mcp.js';
import {
  fetchGoogleHealthSnapshot,
  fetchGoogleHealthWeekSteps,
  formatGoogleHealthSnapshotMarkdown,
  getGoogleHealthUserForRequest,
  isLikelyHealthTaskRequest,
} from './google-health.js';
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
TASK   - wants a specific tool action (calculate, summarize URL, build script,
         list/read files or folders via MCP, create/update Notion pages via MCP,
         call any connected MCP integration)
SEARCH - needs REAL-TIME or CURRENT information including:
         weather, news, prices, sports scores,
         live data, anything that changes day to day,
         finding emails, finding people, company info

IMPORTANT: Any question about current conditions,
today's weather, latest news, current prices = SEARCH
Never classify real-time data questions as CHAT.
Never classify Notion/page/database create-or-save actions as SEARCH — those are TASK.

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

  if (isLikelyMcpTaskRequest(message)) {
    return 'TASK';
  }

  if (isSelfbuildRequest(message)) {
    return 'TASK';
  }

  if (
    !isLikelyMcpTaskRequest(message) &&
    (/\b(search for|look up|find information|latest news|current price|weather|sports score|stock price)\b/.test(m) ||
    /\b(today|right now|currently|this week|live)\b/.test(m) ||
    /\b(find email|find contact|company info|recruiter)\b/.test(m) ||
    /^(what is|who is|when did|where is)\b/.test(m.trim()))
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
  if (hasEnabledMcpServers() && isLikelyMcpTaskRequest(message)) return false;
  if (/\bnotion\b/.test(m) && !/\b(script|tool|sandbox)\b/.test(m)) return false;
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
  if (isLikelyMcpTaskRequest(message)) return 'TASK';

  const rule = ruleBasedIntent(message);
  if (rule) return rule;

  // Skip extra LLM call for short casual messages (reduces free-tier rate limits)
  const trimmed = message.trim();
  if (
    trimmed.length < 120 &&
    !/\b(search|calculate|compute|remember|recall|summarize|weather|news|price|today|current|latest|email|https?:\/\/|list|read|file|folder|directory|mcp|notion|page|database)\b/i.test(trimmed)
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
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(jsonStr);
  } catch {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        /* fall through */
      }
    }
    throw new Error('Tool picker did not return valid JSON');
  }
}

/**
 * Resolve tool name from LLM pick (may omit mcp__ prefix or use short names).
 */
function resolvePickedToolName(rawName, available) {
  const name = String(rawName || '').trim();
  if (!name) return '';
  if (available.some((t) => t.name === name)) return name;

  const normalized = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  for (const t of available) {
    const tn = t.name.toLowerCase();
    if (tn === normalized || tn.endsWith(`__${normalized.replace(/-/g, '_')}`)) return t.name;
    if (tn.includes(normalized.replace(/-/g, '_'))) return t.name;
  }
  return name;
}

/**
 * Ask Qwen which tool to run and with what input string.
 */
async function pickTool(message, options = {}) {
  const builtin = listTools();
  options.mcpSession = options.mcpSession || (await getOrCreateMcpSessionAsync());
  const mcpTools = options.mcpSession
    ? await options.mcpSession.listCatalog().catch((err) => {
        console.warn('[intent] MCP catalog:', err.message);
        return [];
      })
    : await listMcpToolsForRequest().catch((err) => {
        console.warn('[intent] MCP catalog:', err.message);
        return [];
      });
  const mcpNames = new Set(mcpTools.map((t) => t.name));
  const mcpOnly = Boolean(options.mcpIntegration && mcpTools.length);

  const direct = tryDirectMcpPick(message, mcpTools);
  if (direct && mcpNames.has(direct.tool)) {
    console.log(`[intent/mcp] direct pick → ${direct.tool}`);
    return direct;
  }

  const available = mcpOnly ? mcpTools : [...builtin, ...mcpTools];
  if (!available.length) throw new Error('No tools registered');

  const catalog = available.map((t) => `- ${t.name}: ${t.description}`).join('\n');

  const mcpHint = mcpOnly
    ? `This is an MCP integration request. You MUST pick a tool whose name starts with "mcp__".
For Notion: use post-search to find pages, post-page to create pages, retrieve-page-markdown to read.
Reply with ONLY valid JSON, no markdown: {"tool":"mcp__server__tool_name","input":{...}} or {"tool":"...","input":"..."}`
    : mcpTools.length
      ? 'MCP tools are named mcp__<server>__<tool> — use them for filesystem requests and connected integrations (e.g. Notion create/update page). Prefer MCP over selfbuild for integrations.'
      : 'No MCP tools are connected. Do NOT invent mcp__ tool names.';

  let raw;
  try {
    raw = await callLLM(
      [{ role: 'user', content: message }],
      `You are a tool router. Available tools:\n${catalog}\n\nPick the best tool for the user request.
${mcpHint}
Reply with ONLY JSON: {"tool":"tool_name","input":"string or JSON object passed to the tool"}`,
      { stream: false }
    );
  } catch (err) {
    if (mcpOnly) {
      const fallback = fallbackMcpPick(message, mcpTools);
      if (fallback && mcpNames.has(fallback.tool)) {
        console.warn('[intent/mcp] LLM router failed, using fallback pick →', fallback.tool);
        return fallback;
      }
    }
    throw err;
  }

  let pick;
  try {
    pick = parseToolPick(raw);
  } catch (err) {
    if (mcpOnly) {
      const fallback = fallbackMcpPick(message, mcpTools);
      if (fallback && mcpNames.has(fallback.tool)) {
        console.warn('[intent/mcp] invalid JSON from router, using fallback →', fallback.tool);
        return fallback;
      }
    }
    throw err;
  }

  if (!pick?.tool) throw new Error('Tool picker returned invalid JSON');

  const tool = resolvePickedToolName(pick.tool, available);
  const input =
    pick.input != null && typeof pick.input === 'object'
      ? JSON.stringify(pick.input)
      : String(pick.input ?? message);

  if (isMcpToolName(tool) && !mcpNames.has(tool)) {
    const fallback = mcpOnly ? fallbackMcpPick(message, mcpTools) : null;
    if (fallback && mcpNames.has(fallback.tool)) {
      console.warn('[intent/mcp] unknown tool from router, using fallback →', fallback.tool);
      return fallback;
    }
    throw new Error(
      'MCP tool not available. Open Settings → MCP, add your server, click Save MCP, then Test connection.'
    );
  }

  console.log(`[intent/mcp] router pick → ${tool}`);
  return { tool, input };
}

function notionItemTitle(item) {
  if (!item) return 'Untitled';
  if (Array.isArray(item.title)) return item.title[0]?.plain_text || 'Untitled';
  const props = item.properties || {};
  const titleProp = props['Task name'] || props.title || props.Title || props.Name;
  return titleProp?.title?.[0]?.plain_text || 'Untitled';
}

function formatNotionSearchSuccess(content) {
  try {
    const data = JSON.parse(String(content || '').trim());
    if (data?.object !== 'list' || !Array.isArray(data.results)) return null;
    if (!data.results.length) {
      return '**Notion search:** no results found.';
    }
    const lines = data.results.slice(0, 10).map((item) => {
      const title = notionItemTitle(item);
      const kind = item.object === 'data_source' ? 'database' : item.object || 'item';
      const link = item.url ? ` — [open](${item.url})` : '';
      return `- **${title}** (${kind})${link}`;
    });
    const more = data.results.length > 10 ? `\n\n_…and ${data.results.length - 10} more_` : '';
    return `**Notion search** (${data.results.length} result${data.results.length === 1 ? '' : 's'}):\n\n${lines.join('\n')}${more}`;
  } catch {
    return null;
  }
}

function formatNotionPageSuccess(content) {
  try {
    const data = JSON.parse(String(content || '').trim());
    if (data?.object === 'page' && data.url) {
      if (data.archived === true || data.in_trash === true) {
        return formatNotionTrashSuccess(content);
      }
      const titleProp = data.properties?.['Task name'] || data.properties?.title || data.properties?.Name;
      const title =
        titleProp?.title?.[0]?.plain_text ||
        data.properties?.title?.title?.[0]?.plain_text ||
        'New page';
      return `**Notion page created:** ${title}\n\n[Open in Notion](${data.url})`;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function formatNotionTrashSuccess(content) {
  try {
    const data = JSON.parse(String(content || '').trim());
    if (data?.object !== 'page') return null;
    if (data.archived !== true && data.in_trash !== true) return null;
    const title = notionItemTitle(data);
    return (
      `**Moved to Notion trash:** ${title}\n\n` +
      `_Recoverable for ~30 days from Notion trash._`
    );
  } catch {
    return null;
  }
}

/**
 * Format MCP tool output for chat — avoid LLM hallucinating fake setup steps.
 */
function formatMcpReply(toolName, result, message) {
  const content = String(result?.content || '').trim();
  if (!result?.isError) {
    const success =
      formatNotionPageSuccess(content) || formatNotionSearchSuccess(content);
    if (success) return success;
  }
  if (result?.isError) {
    if (/parent\.page_id|parent\.database_id|workspace-level private pages/i.test(content)) {
      return (
        `**Notion needs a parent page or database.**\n\n${content}\n\n` +
        `**Fix:** Retry with:\n` +
        `*"Create a Notion page titled \\"Test from tinyjot\\" under Todo List"*`
      );
    }
    if (/object_not_found|Could not find/i.test(content)) {
      return (
        `**Notion could not create the page.**\n\n${content}\n\n` +
        `**Fix:** In Notion developers → tinyjot → **Content access**, add **Todo List**, then retry:\n` +
        `*"Create a Notion page titled \\"Test from tinyjot\\" under Todo List"*`
      );
    }
    if (/unauthorized|invalid|token/i.test(content)) {
      return (
        `**Notion auth error.**\n\n${content}\n\n` +
        `**Fix:** Settings → MCP → Env → \`NOTION_TOKEN=ntn_...\` → **Save MCP**.`
      );
    }
    return content || `MCP tool ${toolName} failed.`;
  }
  if (!content) {
    return `MCP tool **${toolName}** ran but returned no details. If the page is missing, connect **tinyjot** to your parent page in Notion (⋯ → Connections).`;
  }
  return null;
}

/**
 * Run a tool and synthesize a natural-language reply.
 */
async function runToolAndReply(message, history, options, toolName, toolInput) {
  let result;
  if (isMcpToolName(toolName)) {
    result = await callMcpToolForRequest(toolName, toolInput, options.mcpSession);
  } else {
    ({ result } = await executeTool(toolName, toolInput, {
      onToken: options.onToken,
    }));
  }

  if ((toolName === 'recruiter' || toolName === 'websearch') && result?.answer) {
    return { intent: 'TASK', reply: result.answer, toolUsed: toolName, toolResult: result };
  }

  if (isMcpToolName(toolName)) {
    const direct = formatMcpReply(toolName, result, message);
    let reply = direct;
    if (!reply) {
      reply =
        formatNotionPageSuccess(result.content || '') ||
        formatNotionSearchSuccess(result.content || '') ||
        (result.content?.includes('notion.so') || result.content?.includes('notion.com')
          ? `**Notion result:**\n\n${result.content}`
          : `**Notion MCP result:**\n\n${result.content}`);
    }
    if (options.onToken) options.onToken(reply);
    return { intent: 'TASK', reply, toolUsed: toolName, toolResult: result };
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
    if (isSelfbuildRequest(message) && !isLikelyMcpTaskRequest(message)) {
      return handleSelfbuild(message, history, options);
    }

    if (isRecruiterEmailRequest(message)) {
      return handleRecruiterEmail(message, history, options);
    }

    const { tool, input } = await pickTool(message, options);
    return runToolAndReply(message, history, options, tool, input);
  } catch (err) {
    const reply = logAndPublicError(err, 'intent/task');
    if (options.onToken) options.onToken(reply);
    return { intent: 'TASK', reply, toolUsed: null };
  }
}

async function handleMcpTask(message, history, options = {}) {
  const hasMcp = await hasEnabledMcpServersAsync();
  if (!hasMcp) {
    const reply =
      '**MCP is off for chat.** Open **Settings → MCP**, turn the server **on**, and wait for it to save (the switch saves automatically).';
    if (options.onToken) options.onToken(reply);
    return { intent: 'TASK', reply, toolUsed: null };
  }

  const session = await getOrCreateMcpSessionAsync();
  if (!session) {
    const reply =
      'MCP is not saved for chat yet. Open **Settings → MCP**, confirm your Notion server, click **Save MCP** (Test alone only checks the form — it does not persist). Then try again.';
    if (options.onToken) options.onToken(reply);
    return { intent: 'TASK', reply, toolUsed: null };
  }

  const mcpTools = await session.listCatalog().catch((err) => {
    console.warn('[intent/mcp] catalog failed:', err.message);
    return [];
  });
  if (!mcpTools.length) {
    const reply =
      'Could not connect to MCP (Notion). Re-open Settings → MCP → Env and paste your token as NOTION_TOKEN=ntn_…, click **Save MCP**, wait a few seconds, then Test once. Also connect **tinyjot** to a page in Notion (⋯ → Connections).';
    if (options.onToken) options.onToken(reply);
    return { intent: 'TASK', reply, toolUsed: null };
  }

  if (isNotionAppendToPageMessage(message)) {
    try {
      const result = await notionAppendToPage(session, mcpTools, message);
      const toolName = result.toolUsed || 'mcp__notion__API-patch-block-children';
      const direct = formatMcpReply(toolName, result, message);
      let reply =
        direct ||
        formatNotionPageSuccess(result.content || '') ||
        `**Updated Notion page.**\n\n${result.content}`;
      if (options.onToken) options.onToken(reply);
      return { intent: 'TASK', reply, toolUsed: toolName, toolResult: result };
    } catch (err) {
      const reply = logAndPublicError(err, 'intent/notion');
      if (options.onToken) options.onToken(reply);
      return { intent: 'TASK', reply, toolUsed: null };
    }
  }

  if (isNotionDeletePageMessage(message, { force: options.preferTool === 'notion' })) {
    try {
      const result = await notionDeletePage(session, mcpTools, message, {
        preferTool: options.preferTool,
        force: options.preferTool === 'notion',
      });
      const toolName = result.toolUsed || 'notion-delete';
      let reply;
      if (result.isError) {
        reply = result.content || 'Could not delete Notion page.';
      } else {
        reply =
          formatNotionTrashSuccess(result.content || '') ||
          `**Moved to Notion trash.**\n\n_Recoverable for ~30 days from Notion trash._`;
      }
      if (options.onToken) options.onToken(reply);
      return { intent: 'TASK', reply, toolUsed: toolName, toolResult: result };
    } catch (err) {
      const reply = logAndPublicError(err, 'intent/notion');
      if (options.onToken) options.onToken(reply);
      return { intent: 'TASK', reply, toolUsed: null };
    }
  }

  if (isNotionCreatePageMessage(message)) {
    try {
      const result = await notionCreatePage(session, mcpTools, message);
      const toolName = result.toolUsed || 'mcp__notion__API-post-page';
      const direct = formatMcpReply(toolName, result, message);
      let reply = direct;
      if (!reply) {
        reply =
          formatNotionPageSuccess(result.content || '') ||
          formatNotionSearchSuccess(result.content || '') ||
          (result.content?.includes('notion.so') || result.content?.includes('notion.com')
            ? `**Notion page created.**\n\n${result.content}`
            : `**Notion MCP result:**\n\n${result.content}`);
      }
      if (options.onToken) options.onToken(reply);
      return { intent: 'TASK', reply, toolUsed: toolName, toolResult: result };
    } catch (err) {
      const reply = logAndPublicError(err, 'intent/notion');
      if (options.onToken) options.onToken(reply);
      return { intent: 'TASK', reply, toolUsed: null };
    }
  }

  return handleTask(message, history, { ...options, mcpIntegration: true, mcpSession: session });
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
    const reply = logAndPublicError(err, 'intent/search');
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
    const reply = logAndPublicError(err, 'intent/recruiter');
    if (options.onToken) options.onToken(reply);
    return { intent: 'SEARCH', reply, toolUsed: 'recruiter' };
  }
}

/**
 * HEALTH — Google Health (Fitbit / Pixel Watch) snapshot + optional LLM coach.
 */
async function handleHealthTask(message, history, options = {}) {
  try {
    const user = await getGoogleHealthUserForRequest();
    if (!user) {
      const reply =
        '**Sign in required** to use Google Health coaching.';
      if (options.onToken) options.onToken(reply);
      return { intent: 'TASK', reply, toolUsed: null };
    }
    if (!user.settings?.googleHealthRefreshToken) {
      const reply =
        '**Google Health is not connected.** Open **Integrations** → **Connect Google Health**, authorize Fitbit / Pixel Watch data, then try again.\n\nTry: `/health summarize today`';
      if (options.onToken) options.onToken(reply);
      return { intent: 'TASK', reply, toolUsed: 'google-health' };
    }

    const snapshot = await fetchGoogleHealthSnapshot(user);
    const weekSteps = await fetchGoogleHealthWeekSteps(user).catch(() => []);
    const matrix = formatGoogleHealthSnapshotMarkdown(snapshot);

    const wantsCoach = /\b(coach|advice|recommend|how|improve|overtrain|summarize|summary|what|should)\b/i.test(
      message
    );

    if (!wantsCoach && /^(show|get|fetch|check)\b/i.test(message.trim())) {
      if (options.onToken) options.onToken(matrix);
      return { intent: 'TASK', reply: matrix, toolUsed: 'google-health', toolResult: snapshot };
    }

    const systemPrompt = await withMemory(
      `You are ${getBotName()}, a concise AI wellness coach (not a doctor).
You received REAL Google Health / Fitbit metrics for the user — do not invent numbers.
Give a short markdown coach note:
- 3–6 bullets: what looks good, what to watch, one practical tip for today
- Flag low sleep, very high sedentary minutes, or missing data briefly
- Never diagnose disease; say this is wellness guidance only
Do not repeat the raw metrics table — it is already shown above your note.`,
      message
    );

    const userBlock = [
      `User request: ${message}`,
      'Google Health snapshot:',
      JSON.stringify({ snapshot, weekSteps }, null, 2),
      'Formatted matrix (already shown to user):',
      matrix,
    ].join('\n\n');

    const prefix = `${matrix}\n\n---\n\n`;
    if (options.onToken) options.onToken(prefix);

    const coach = await callLLM(
      [...history.slice(-4), { role: 'user', content: userBlock }],
      systemPrompt,
      { stream: true, onToken: options.onToken }
    );

    return {
      intent: 'TASK',
      reply: `${prefix}${coach}`,
      toolUsed: 'google-health',
      toolResult: snapshot,
    };
  } catch (err) {
    const reply = logAndPublicError(err, 'intent/health');
    if (options.onToken) options.onToken(reply);
    return { intent: 'TASK', reply, toolUsed: 'google-health' };
  }
}

/**
 * Normalize client preferTool (from /slash command).
 * @returns {'websearch'|'notion'|'sandbox'|'health'|null}
 */
function normalizePreferTool(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/^[/]/, '');
  if (t === 'websearch' || t === 'web' || t === 'search') return 'websearch';
  if (t === 'notion') return 'notion';
  if (t === 'sandbox' || t === 'selfbuild') return 'sandbox';
  if (t === 'health' || t === 'fitbit' || t === 'fitness') return 'health';
  return null;
}

/**
 * Route a user message to the correct handler based on classified intent.
 * @param {string} message
 * @param {Array<{ role: string, content: string }>} history
 * @param {{ sessionId?: string, onToken?: (chunk: string) => void, stream?: boolean, task?: object, preferTool?: string|null }} [options]
 */
export async function routeMessage(message, history = [], options = {}) {
  if (!getLlmApiKey()) {
    console.error(
      '[intent] OpenRouter is not configured. Add API key in Settings → BYOK, or set OPENROUTER_API_KEY on the server.'
    );
    const reply = PUBLIC_ERROR;
    if (options.onToken) options.onToken(reply);
    return { intent: 'CHAT', reply, toolUsed: null };
  }

  const preferTool = normalizePreferTool(options.preferTool);
  if (preferTool === 'websearch') {
    console.log(`[intent] PREFER websearch — session ${options.sessionId || 'none'}`);
    return handleSearch(message, history, options);
  }
  if (preferTool === 'sandbox') {
    console.log(`[intent] PREFER sandbox — session ${options.sessionId || 'none'}`);
    return handleSelfbuild(message, history, options);
  }
  if (preferTool === 'notion') {
    console.log(`[intent] PREFER notion — session ${options.sessionId || 'none'}`);
    return handleMcpTask(message, history, { ...options, preferTool: 'notion' });
  }
  if (preferTool === 'health') {
    console.log(`[intent] PREFER health — session ${options.sessionId || 'none'}`);
    return handleHealthTask(message, history, options);
  }

  if (isLikelyHealthTaskRequest(message)) {
    console.log(`[intent] HEALTH_TASK — session ${options.sessionId || 'none'}`);
    return handleHealthTask(message, history, options);
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

  // Notion/MCP before sandbox script delete — "delete X from notion" is not a script
  if (isLikelyMcpTaskRequest(message)) {
    console.log(`[intent] MCP_TASK — session ${options.sessionId || 'none'}`);
    return handleMcpTask(message, history, options);
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
