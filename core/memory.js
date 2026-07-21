import { callLLM } from './llm.js';
import { Entity, Relation, Session, User, isMongoReady } from '../db/mongo.js';

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
 * Sets expiresAt from the user's chat retention so MongoDB TTL can delete it.
 * @param {string} sessionId
 * @param {Array<{role: string, content: string, intent?: string}>} messages
 * @param {string | null} [userId]
 * @param {number | null} [retentionDays]
 */
export async function saveSession(sessionId, messages, userId = null, retentionDays = null) {
  if (!isMongoReady() || !sessionId) return;

  const trimmed = messages.slice(-MAX_SESSION_MESSAGES);
  const now = new Date();

  try {
    let days = retentionDays;
    if (days == null && userId) {
      const user = await User.findById(userId).select('settings.chatRetentionDays').lean();
      days = user?.settings?.chatRetentionDays;
    }
    const retention = normalizeRetentionDays(days);
    const expiresAt = expiresAtFrom(now, retention);

    const $set = { messages: trimmed, updatedAt: now, expiresAt };
    if (userId) $set.userId = userId;

    await Session.findOneAndUpdate(
      { sessionId },
      {
        $set,
        $setOnInsert: { createdAt: now },
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
 * Load session doc metadata (for chat topbar timer).
 * @param {string} sessionId
 * @returns {Promise<{ messages: Array, updatedAt: Date | null, expiresAt: Date | null } | null>}
 */
export async function loadSessionDoc(sessionId) {
  if (!isMongoReady() || !sessionId) return null;

  try {
    const doc = await Session.findOne({ sessionId })
      .select('messages updatedAt expiresAt')
      .lean();
    if (!doc) return null;
    return {
      messages: doc.messages ?? [],
      updatedAt: doc.updatedAt || null,
      expiresAt: doc.expiresAt || null,
    };
  } catch (err) {
    console.warn('[memory] loadSessionDoc failed:', err.message);
    return null;
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

const RETENTION_DAYS = new Set([7, 11, 15]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param {unknown} days
 * @returns {7 | 11 | 15}
 */
export function normalizeRetentionDays(days) {
  const n = Number(days);
  return RETENTION_DAYS.has(n) ? n : 7;
}

/**
 * @param {Date | string | number} from
 * @param {number} days
 */
function expiresAtFrom(from, days) {
  const base = from instanceof Date ? from.getTime() : new Date(from).getTime();
  const t = Number.isFinite(base) ? base : Date.now();
  return new Date(t + normalizeRetentionDays(days) * MS_PER_DAY);
}

function userSessionFilter(userId) {
  return {
    $or: [{ userId }, { sessionId: new RegExp(`^${String(userId)}:`) }],
  };
}

/**
 * Delete chats past retention (expiresAt or updatedAt cutoff).
 * @param {string} userId
 * @param {number} [days]
 * @returns {Promise<number>} deleted count
 */
export async function pruneExpiredSessions(userId, days = 7) {
  if (!isMongoReady() || !userId) return 0;

  const retention = normalizeRetentionDays(days);
  const now = new Date();
  const cutoff = new Date(now.getTime() - retention * MS_PER_DAY);

  try {
    const result = await Session.deleteMany({
      $and: [
        userSessionFilter(userId),
        {
          $or: [
            { expiresAt: { $lte: now } },
            { expiresAt: null, updatedAt: { $lt: cutoff } },
            { expiresAt: { $exists: false }, updatedAt: { $lt: cutoff } },
          ],
        },
      ],
    });
    return result.deletedCount || 0;
  } catch (err) {
    console.warn('[memory] pruneExpiredSessions failed:', err.message);
    return 0;
  }
}

/**
 * Recompute expiresAt for a user's chats after they change 7d/11d/15d,
 * and delete anything already past the new window.
 * @param {string} userId
 * @param {number} days
 * @returns {Promise<{ deleted: number, updated: number }>}
 */
export async function refreshSessionExpiries(userId, days) {
  if (!isMongoReady() || !userId) return { deleted: 0, updated: 0 };

  const retention = normalizeRetentionDays(days);
  const now = new Date();
  const cutoff = new Date(now.getTime() - retention * MS_PER_DAY);

  try {
    const deleted = await Session.deleteMany({
      $and: [userSessionFilter(userId), { updatedAt: { $lt: cutoff } }],
    });

    const docs = await Session.find(userSessionFilter(userId))
      .select('_id updatedAt')
      .lean();

    if (!docs.length) {
      return { deleted: deleted.deletedCount || 0, updated: 0 };
    }

    const ops = docs.map((d) => ({
      updateOne: {
        filter: { _id: d._id },
        update: {
          $set: { expiresAt: expiresAtFrom(d.updatedAt || now, retention) },
        },
      },
    }));

    const bulk = await Session.bulkWrite(ops, { ordered: false });
    return {
      deleted: deleted.deletedCount || 0,
      updated: bulk.modifiedCount || 0,
    };
  } catch (err) {
    console.warn('[memory] refreshSessionExpiries failed:', err.message);
    return { deleted: 0, updated: 0 };
  }
}

/**
 * Orphan sweeper: delete expired chats for every user + backfill missing expiresAt.
 * Runs on a timer so deletion does not depend on opening the sidebar.
 * @returns {Promise<{ deleted: number, backfilled: number }>}
 */
export async function sweepAllExpiredSessions() {
  if (!isMongoReady()) return { deleted: 0, backfilled: 0 };

  const now = new Date();
  let deleted = 0;
  let backfilled = 0;

  try {
    const byExpiry = await Session.deleteMany({
      expiresAt: { $type: 'date', $lte: now },
    });
    deleted += byExpiry.deletedCount || 0;

    const users = await User.find({})
      .select('_id settings.chatRetentionDays')
      .lean();

    for (const user of users) {
      const retention = normalizeRetentionDays(user.settings?.chatRetentionDays);
      const cutoff = new Date(now.getTime() - retention * MS_PER_DAY);
      const uid = String(user._id);

      const gone = await Session.deleteMany({
        $and: [
          userSessionFilter(uid),
          {
            $or: [
              { expiresAt: { $type: 'date', $lte: now } },
              { updatedAt: { $lt: cutoff } },
            ],
          },
        ],
      });
      deleted += gone.deletedCount || 0;

      const missing = await Session.find({
        $and: [
          userSessionFilter(uid),
          {
            $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }],
          },
        ],
      })
        .select('_id updatedAt')
        .lean();

      if (!missing.length) continue;

      const ops = missing.map((d) => ({
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: { expiresAt: expiresAtFrom(d.updatedAt || now, retention) },
          },
        },
      }));
      const bulk = await Session.bulkWrite(ops, { ordered: false });
      backfilled += bulk.modifiedCount || 0;
    }

    // Orphan sessions with no userId — default 7d
    const orphanCutoff = new Date(now.getTime() - 7 * MS_PER_DAY);
    const orphans = await Session.deleteMany({
      $and: [
        { $or: [{ userId: null }, { userId: { $exists: false } }] },
        {
          $or: [
            { expiresAt: { $type: 'date', $lte: now } },
            { updatedAt: { $lt: orphanCutoff } },
          ],
        },
      ],
    });
    deleted += orphans.deletedCount || 0;

    if (deleted || backfilled) {
      console.log(
        `[memory] sweep: deleted=${deleted} backfilledExpiresAt=${backfilled}`
      );
    }

    return { deleted, backfilled };
  } catch (err) {
    console.warn('[memory] sweepAllExpiredSessions failed:', err.message);
    return { deleted, backfilled };
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
