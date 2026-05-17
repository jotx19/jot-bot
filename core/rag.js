import { randomUUID } from 'crypto';
import fetch from 'node-fetch';
import { isFreeTierModel } from './llm.js';
import { upsertEmbedding, searchSimilar, ensureCollection } from '../db/qdrant.js';

const EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

/**
 * Build OpenRouter headers for embedding requests.
 */
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
    'X-Title': process.env.BOT_NAME || 'tinyjot',
  };
}

/**
 * Generate a 1536-dimension embedding via OpenRouter.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const input = text.slice(0, 8000);

  try {
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(EMBEDDINGS_URL, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
      });
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      break;
    }

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('Embedding rate limit — RAG indexing skipped for this turn');
      }
      const errText = await res.text();
      throw new Error(`Embedding API error ${res.status}: ${errText}`);
    }

    const json = await res.json();
    const vector = json.data?.[0]?.embedding;
    if (!vector?.length) {
      throw new Error('Embedding API returned empty vector');
    }
    return vector;
  } catch (err) {
    if (err.message?.includes('Embedding')) throw err;
    throw new Error(`embedText failed: ${err.message}`);
  }
}

/**
 * Embed and store a chat message in Qdrant.
 * @param {string} role - 'user' | 'assistant'
 * @param {string} content
 * @param {string} sessionId
 */
export async function storeMessage(role, content, sessionId) {
  if (!process.env.QDRANT_URL || !content?.trim()) return;

  // Skip embedding API on free models — saves rate limit budget for chat
  if (process.env.SKIP_RAG_EMBED !== 'false' && isFreeTierModel()) {
    return;
  }

  try {
    await ensureCollection();
    const vector = await embedText(`${role}: ${content}`);
    const id = randomUUID();

    await upsertEmbedding(id, vector, {
      role,
      content,
      sessionId,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[rag] storeMessage failed:', err.message);
  }
}

/**
 * Store both sides of a chat turn (user + assistant).
 * @param {string} sessionId
 * @param {string} userMessage
 * @param {string} assistantReply
 */
export async function storeExchange(sessionId, userMessage, assistantReply) {
  const sid = sessionId || 'default';
  await storeMessage('user', userMessage, sid);
  if (assistantReply) {
    await storeMessage('assistant', assistantReply, sid);
  }
}

/**
 * Retrieve top-K semantically similar past messages for a query.
 * @param {string} query
 * @param {string} sessionId
 * @param {number} [topK=5]
 * @returns {Promise<Array<{ role: string, content: string, score: number }>>}
 */
export async function retrieveContext(query, sessionId, topK = 5) {
  if (!process.env.QDRANT_URL) return [];

  try {
    await ensureCollection();
    const vector = await embedText(query);
    const hits = await searchSimilar(vector, topK, sessionId || 'default');

    return hits
      .filter((h) => h.payload?.content)
      .map((h) => ({
        role: h.payload.role,
        content: h.payload.content,
        score: h.score,
      }));
  } catch (err) {
    console.warn('[rag] retrieveContext failed:', err.message);
    return [];
  }
}

/**
 * Format retrieved messages as a prompt block.
 * @param {Array<{ role: string, content: string }>} contexts
 * @returns {string}
 */
export function formatContextBlock(contexts) {
  if (!contexts?.length) return '(no relevant past messages found in vector memory)';
  return contexts
    .map((c, i) => `[${i + 1}] ${c.role}: ${c.content}`)
    .join('\n');
}

export { ensureCollection };
