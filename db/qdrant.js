import { QdrantClient } from '@qdrant/js-client-rest';

export const COLLECTION_NAME = 'chat_memory';
export const VECTOR_SIZE = 1536;

let client = null;
let collectionReady = false;

/**
 * Get or create the Qdrant REST client from environment variables.
 */
function getClient() {
  if (!process.env.QDRANT_URL) {
    return null;
  }
  if (!client) {
    client = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY || undefined,
    });
  }
  return client;
}

/**
 * Ensure the chat_memory collection exists with correct vector size.
 */
export async function ensureCollection() {
  const qdrant = getClient();
  if (!qdrant) {
    console.warn('[qdrant] QDRANT_URL not set — RAG disabled');
    return false;
  }

  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections?.some((c) => c.name === COLLECTION_NAME);

    if (!exists) {
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
      });
      console.log(`[qdrant] Created collection "${COLLECTION_NAME}"`);
    }

    collectionReady = true;
    return true;
  } catch (err) {
    collectionReady = false;
    console.error('[qdrant] ensureCollection failed:', err.message);
    throw err;
  }
}

/**
 * Upsert a single embedding point into chat_memory.
 * @param {string} id - Unique point ID
 * @param {number[]} vector - Embedding vector (length 1536)
 * @param {object} payload - Metadata (role, content, sessionId, etc.)
 */
export async function upsertEmbedding(id, vector, payload) {
  const qdrant = getClient();
  if (!qdrant || !collectionReady) {
    throw new Error('Qdrant is not initialized');
  }

  if (vector.length !== VECTOR_SIZE) {
    throw new Error(`Vector must be length ${VECTOR_SIZE}, got ${vector.length}`);
  }

  try {
    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: [{ id, vector, payload }],
    });
  } catch (err) {
    throw new Error(`Qdrant upsert failed: ${err.message}`);
  }
}

/**
 * Search for similar vectors, optionally scoped to a session.
 * @param {number[]} vector
 * @param {number} [topK=5]
 * @param {string} [sessionId] - Filter results to this session
 * @returns {Promise<Array<{ score: number, payload: object }>>}
 */
export async function searchSimilar(vector, topK = 5, sessionId = null) {
  const qdrant = getClient();
  if (!qdrant || !collectionReady) {
    return [];
  }

  const filter = sessionId
    ? { must: [{ key: 'sessionId', match: { value: sessionId } }] }
    : undefined;

  try {
    const results = await qdrant.search(COLLECTION_NAME, {
      vector,
      limit: topK,
      filter,
      with_payload: true,
    });

    return results.map((r) => ({
      score: r.score,
      payload: r.payload,
    }));
  } catch (err) {
    throw new Error(`Qdrant search failed: ${err.message}`);
  }
}

/**
 * Qdrant status for health checks.
 */
export function getQdrantStatus() {
  return {
    configured: Boolean(process.env.QDRANT_URL),
    ready: collectionReady,
  };
}
