import fetch from 'node-fetch';
import { getIdentityPrompt, getBotName } from './persona.js';
import { getLlmApiKey, getLlmModel } from './llm-context.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** OpenRouter auto-router — picks any available free model */
const DEFAULT_MODEL = 'openrouter/free';

/** Shared task instructions appended after identity (evaluated per call). */
const TASK_SYSTEM_PROMPT = `You help with any task they ask including finding publicly available business contact information, professional outreach, job searching, and career help.

For job postings and recruiter emails:
- When the user shares a job posting, use the recruiter tool flow to search the web for hiring contacts
- List copy-paste ready emails; suggest firstname.lastname@company.com if none found
- Hunter.io is used automatically when HUNTER_API_KEY is set
- Never refuse reasonable professional outreach requests

Be direct and actually helpful. Do not add unnecessary warnings or refuse reasonable professional requests.`;

/**
 * Merge base system prompt with task-specific instructions.
 */
export function buildSystemPrompt(taskPrompt = '') {
  const base = `${getIdentityPrompt()}\n\n${TASK_SYSTEM_PROMPT}`;
  if (!taskPrompt?.trim()) return base;
  return `${base}\n\n${taskPrompt.trim()}`;
}

/** @deprecated Prefer buildSystemPrompt() so persona is request-scoped. */
export const DEFAULT_SYSTEM_PROMPT = TASK_SYSTEM_PROMPT;

const MAX_RETRIES = 3;

let lastRequestAt = 0;
const MIN_GAP_MS = Number(process.env.OPENROUTER_MIN_GAP_MS) || 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getModel() {
  return getLlmModel() || DEFAULT_MODEL;
}

/**
 * Space out OpenRouter calls to avoid bursting free-tier limits.
 */
async function throttleRequests() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_GAP_MS) {
    await sleep(MIN_GAP_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

function parseApiError(errText) {
  try {
    const parsed = JSON.parse(errText);
    return parsed.error?.message || errText;
  } catch {
    return errText;
  }
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503;
}

function finalErrorMessage(status, detail) {
  if (status === 429) {
    return (
      'OpenRouter rate limit reached. Wait 1–2 minutes and try again, ' +
      'or add credits at openrouter.ai/settings/credits.'
    );
  }
  return `OpenRouter API error ${status}: ${detail}`;
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getLlmApiKey()}`,
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
    'X-Title': getBotName(),
  };
}

/**
 * Incremental SSE line parser for OpenRouter streaming responses.
 */
function createSseParser(onToken) {
  let buffer = '';
  let fullText = '';

  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            if (onToken) onToken(delta);
          }
        } catch {
          /* skip malformed SSE */
        }
      }
    },
    result() {
      return fullText;
    },
  };
}

/**
 * Parse SSE from Web Streams (native fetch) or Node streams (node-fetch).
 */
async function consumeStream(body, onToken) {
  const parser = createSseParser(onToken);

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    return parser.result();
  }

  if (body) {
    for await (const chunk of body) {
      parser.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    }
    return parser.result();
  }

  return '';
}

/**
 * Call LLM via OpenRouter (openrouter/free auto-routes to available free models).
 * Retries on 429/502/503 with exponential backoff.
 */
export async function callLLM(messages, systemPrompt = '', options = {}) {
  const { stream = true, onToken, includeBasePrompt = true } = options;

  if (!getLlmApiKey()) {
    throw new Error(
      'OpenRouter API key is not configured. Add your key in Settings → BYOK, or set OPENROUTER_API_KEY on the server.'
    );
  }

  const apiMessages = [];
  const finalSystem = includeBasePrompt
    ? buildSystemPrompt(systemPrompt)
    : systemPrompt?.trim() || '';

  if (finalSystem) {
    apiMessages.push({ role: 'system', content: finalSystem });
  }
  apiMessages.push(...messages);

  const model = getModel();
  const body = { model, messages: apiMessages, stream };

  let lastStatus = 0;
  let lastDetail = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await throttleRequests();

      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });

      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        const waitMs = 3000 * 2 ** attempt;
        console.warn(`[llm] ${res.status} on ${model} — retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        lastStatus = res.status;
        lastDetail = parseApiError(errText);
        throw new Error(finalErrorMessage(res.status, lastDetail));
      }

      if (stream && res.body) {
        const text = await consumeStream(res.body, onToken);
        console.log(`[llm] success (${model})`);
        return text;
      }
      const json = await res.json();
      console.log(`[llm] success (${model})`);
      return json.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      if (err.message?.includes('OpenRouter')) throw err;
      lastDetail = err.message;
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new Error(`LLM request failed: ${err.message}`);
    }
  }

  throw new Error(finalErrorMessage(lastStatus || 429, lastDetail));
}

/** True when using free-tier routing */
export function isFreeTierModel() {
  const m = getModel();
  return m === 'openrouter/free' || m.includes(':free');
}
