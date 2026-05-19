import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
} from 'discord.js';
import { runChatTurn } from '../core/runtime.js';
import { storeExchange } from '../core/rag.js';
import { loadSession, saveSession } from '../core/memory.js';

const INTENT_BADGES = {
  CHAT: '💬',
  RECALL: '🧠',
  LEARN: '📝',
  TASK: '🔧',
  SEARCH: '🔍',
  ERROR: '⚠️',
};

const DISCORD_MAX_LEN = 2000;
const sessionCache = new Map();

/**
 * Build per-user Discord session id (shared MongoDB with web).
 */
function getSessionId(authorId) {
  return `${authorId}-discord`;
}

/**
 * Load chat history from cache or MongoDB.
 */
async function getHistory(sessionId) {
  if (sessionCache.has(sessionId)) {
    return sessionCache.get(sessionId);
  }
  const loaded = await loadSession(sessionId);
  sessionCache.set(sessionId, loaded);
  return loaded;
}

/**
 * Persist turn to MongoDB and refresh cache.
 */
async function persistTurn(sessionId, history, message, reply, intent) {
  const updated = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: reply, intent },
  ];
  sessionCache.set(sessionId, updated);
  await saveSession(sessionId, updated);
}

/**
 * Strip bot mention from message text.
 */
function stripMention(content, client) {
  const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
  return content.replace(mentionRegex, '').trim();
}

/**
 * Whether the bot should respond to this message.
 */
function shouldRespond(message, client) {
  if (message.author.bot) return false;
  const isDm = !message.guild;
  const isMentioned = message.mentions.users.has(client.user.id);
  return isDm || isMentioned;
}

/**
 * Prefix reply with intent emoji badge.
 */
function formatWithBadge(intent, text) {
  const badge = INTENT_BADGES[intent] || '💬';
  return `${badge} ${text}`;
}

/**
 * Split long text for Discord's 2000 character limit.
 */
function splitForDiscord(text, maxLen = DISCORD_MAX_LEN - 10) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Keep typing indicator alive during long LLM calls.
 */
async function withTyping(channel, work) {
  await channel.sendTyping();
  const typingTimer = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 8000);

  try {
    return await work();
  } finally {
    clearInterval(typingTimer);
  }
}

/**
 * Send one or more Discord messages (chunked).
 */
async function sendReply(message, intent, replyText) {
  const formatted = formatWithBadge(intent, replyText);
  const chunks = splitForDiscord(formatted);

  for (let i = 0; i < chunks.length; i++) {
    const payload = chunks[i];
    if (i === 0) {
      await message.reply({ content: payload, allowedMentions: { repliedUser: false } });
    } else {
      await message.channel.send(payload);
    }
  }
}

/**
 * Process one user message through the same pipeline as web chat.
 */
async function handleDiscordMessage(message, client) {
  const sessionId = getSessionId(message.author.id);
  const userText = stripMention(message.content, client);

  if (!userText) return;

  const history = await getHistory(sessionId);

  const turn = await withTyping(message.channel, () =>
    runChatTurn({
      message: userText,
      history,
      sessionId,
      channel: 'discord',
    })
  );

  if (!turn.ok) {
    await sendReply(message, 'ERROR', `Something went wrong: ${turn.error}`);
    console.warn(`[discord] task ${turn.task?.id} FAILED: ${turn.error}`);
    return;
  }

  const result = turn.result;
  const reply = result.reply || 'No response.';
  const intent = result.intent || 'CHAT';

  await sendReply(message, intent, reply);

  storeExchange(sessionId, userText, reply).catch((err) => {
    console.warn('[discord] RAG index failed:', err.message);
  });
  await persistTurn(sessionId, history, userText, reply, intent);

  console.log(`[discord] ${intent} — user ${message.author.id}`);
}

/**
 * Start the Discord bot (optional interface).
 */
export async function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log('[discord] skipped — no DISCORD_BOT_TOKEN set');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[discord] bot online as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!shouldRespond(message, client)) return;

    try {
      await handleDiscordMessage(message, client);
    } catch (err) {
      console.error('[discord]', err.message);
      try {
        await message.reply({
          content: `${INTENT_BADGES.ERROR} Something went wrong. Try again.`,
          allowedMentions: { repliedUser: false },
        });
      } catch {
        /* ignore send failures */
      }
    }
  });

  client.on('error', (err) => {
    console.error('[discord] client error:', err.message);
  });

  await client.login(token);
}

