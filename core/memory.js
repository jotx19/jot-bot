import { callLLM } from './llm.js';
import { Entity, Relation, Session, isMongoReady } from '../db/mongo.js';

const MAX_SESSION_MESSAGES = 50;
const EXTRACT_SYSTEM = `Extract structured knowledge from the user message.
Return ONLY valid JSON with this shape (no markdown):
{
  "entities": [{"name": "string", "type": "person|place|preference|fact", "properties": {}}],
  "relations": [{"entity1": "string", "relation": "string", "entity2": "string"}]
}
Use short entity names. If nothing to extract, return {"entities":[],"relations":[]}.`;

/**
 * Parse JSON from LLM output, tolerating fenced code blocks.
 */
function parseJsonSafe(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonStr);
}

/**
 * Use Qwen to extract names, facts, and preferences from a message.
 * @param {string} message
 * @returns {Promise<{ entities: Array, relations: Array }>}
 */
export async function extractEntities(message) {
  try {
    const raw = await callLLM(
      [{ role: 'user', content: message }],
      EXTRACT_SYSTEM,
      { stream: false }
    );
    const parsed = parseJsonSafe(raw);
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
    };
  } catch (err) {
    console.warn('[memory] extractEntities failed:', err.message);
    return { entities: [], relations: [] };
  }
}

/**
 * Persist extracted entities and relations to MongoDB.
 * @param {{ entities: Array, relations: Array }} data
 */
export async function saveToMemory(data) {
  if (!isMongoReady()) return;

  const { entities = [], relations = [] } = data;

  try {
    for (const e of entities) {
      if (!e?.name) continue;
      await Entity.findOneAndUpdate(
        { name: e.name, type: e.type || 'fact' },
        {
          $set: {
            properties: e.properties || {},
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true, new: true }
      );
    }

    for (const r of relations) {
      if (!r?.entity1 || !r?.relation || !r?.entity2) continue;
      await Relation.create({
        entity1: r.entity1,
        relation: r.relation,
        entity2: r.entity2,
        createdAt: new Date(),
      });
    }
  } catch (err) {
    console.warn('[memory] saveToMemory failed:', err.message);
  }
}

/**
 * Fetch relevant entities/relations from MongoDB using keyword text search.
 * @param {string} query
 * @returns {Promise<{ entities: Array, relations: Array }>}
 */
export async function recallMemory(query) {
  if (!isMongoReady() || !query?.trim()) {
    return { entities: [], relations: [] };
  }

  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2)
    .slice(0, 6);

  if (!terms.length) return { entities: [], relations: [] };

  try {
    const entities = await Entity.find({
      $or: [
        ...terms.map((t) => ({ name: { $regex: t, $options: 'i' } })),
        ...terms.map((t) => ({ type: { $regex: t, $options: 'i' } })),
      ],
    })
      .sort({ createdAt: -1 })
      .limit(15)
      .lean();

    const entityNames = entities.map((e) => e.name);
    const relations = await Relation.find({
      $or: [
        { entity1: { $in: entityNames } },
        { entity2: { $in: entityNames } },
        ...terms.map((t) => ({ relation: { $regex: t, $options: 'i' } })),
        ...terms.map((t) => ({ entity1: { $regex: t, $options: 'i' } })),
        ...terms.map((t) => ({ entity2: { $regex: t, $options: 'i' } })),
      ],
    })
      .sort({ createdAt: -1 })
      .limit(15)
      .lean();

    return { entities, relations };
  } catch (err) {
    console.warn('[memory] recallMemory failed:', err.message);
    return { entities: [], relations: [] };
  }
}

/**
 * Format graph memory for injection into system prompts.
 */
export function formatMemoryBlock({ entities, relations }) {
  if (!entities?.length && !relations?.length) {
    return '(no stored facts about the user yet)';
  }

  const lines = [];
  for (const e of entities) {
    const props =
      e.properties && Object.keys(e.properties).length
        ? ` — ${JSON.stringify(e.properties)}`
        : '';
    lines.push(`- ${e.name} (${e.type || 'fact'})${props}`);
  }
  for (const r of relations) {
    lines.push(`- ${r.entity1} ${r.relation} ${r.entity2}`);
  }
  return lines.join('\n');
}

/**
 * Build memory context string for any user message.
 * @param {string} message
 */
export async function getMemoryContext(message) {
  const memory = await recallMemory(message);
  return formatMemoryBlock(memory);
}

/**
 * Persist full chat session (keeps last N messages lean for M0 tier).
 * @param {string} sessionId
 * @param {Array<{role: string, content: string, intent?: string}>} messages
 * @param {string | null} [userId]
 */
export async function saveSession(sessionId, messages, userId = null) {
  if (!isMongoReady() || !sessionId) return;

  const trimmed = messages.slice(-MAX_SESSION_MESSAGES);

  try {
    const $set = { messages: trimmed, updatedAt: new Date() };
    if (userId) $set.userId = userId;

    await Session.findOneAndUpdate(
      { sessionId },
      {
        $set,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  } catch (err) {
    console.warn('[memory] saveSession failed:', err.message);
  }
}

/**
 * Load past session messages from MongoDB.
 * @param {string} sessionId
 * @returns {Promise<Array<{role: string, content: string, intent?: string}>>}
 */
export async function loadSession(sessionId) {
  if (!isMongoReady() || !sessionId) return [];

  try {
    const doc = await Session.findOne({ sessionId }).lean();
    return doc?.messages ?? [];
  } catch (err) {
    console.warn('[memory] loadSession failed:', err.message);
    return [];
  }
}

/**
 * Remove all messages for a session.
 * @param {string} sessionId
 */
export async function clearSession(sessionId) {
  if (!isMongoReady() || !sessionId) return;

  try {
    await Session.deleteOne({ sessionId });
  } catch (err) {
    console.warn('[memory] clearSession failed:', err.message);
    throw err;
  }
}

/**
 * LEARN flow: extract entities from message and save to graph memory.
 * @param {string} message
 */
export async function learnFromMessage(message) {
  const extracted = await extractEntities(message);
  await saveToMemory(extracted);
  return extracted;
}
