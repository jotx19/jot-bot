import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
} from 'discord.js';
import { runChatTurn } from '../core/runtime.js';
import { storeExchange } from '../core/rag.js';
import { loadSession, saveSession } from '../core/memory.js';
import { getDiscordAllowlist } from '../core/users.js';
import { runWithLlmCredentials, credsFromUserDoc } from '../core/llm-context.js';
import { User, isMongoReady } from '../db/mongo.js';

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
/** @type {Set<string> | null} */
let allowlistCache = null;
let allowlistLoadedAt = 0;
const ALLOWLIST_TTL_MS = 60_000;

async function getAllowlistCached() {
  const now = Date.now();
  if (allowlistCache && now - allowlistLoadedAt < ALLOWLIST_TTL_MS) {
    return allowlistCache;
  }
  allowlistCache = await getDiscordAllowlist();
  allowlistLoadedAt = now;
  return allowlistCache;
}

export function invalidateDiscordAllowlistCache() {
  allowlistCache = null;
  allowlistLoadedAt = 0;
}

function getSessionId(authorId) {
  return `${authorId}-discord`;
}

async function getHistory(sessionId) {
  if (sessionCache.has(sessionId)) {
    return sessionCache.get(sessionId);
  }
  const loaded = await loadSession(sessionId);
  sessionCache.set(sessionId, loaded);
  return loaded;
}

async function persistTurn(sessionId, history, message, reply, intent) {
  const updated = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: reply, intent },
  ];
  sessionCache.set(sessionId, updated);
  await saveSession(sessionId, updated);
}

function stripMention(content, client) {
  const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
  return content.replace(mentionRegex, '').trim();
}

function shouldRespond(message, client) {
  if (message.author.bot) return false;
  const isDm = !message.guild;
  const isMentioned = message.mentions.users.has(client.user.id);
  return isDm || isMentioned;
}

async function isAuthorizedDiscordUser(message) {
  const allowedUsers = await getAllowlistCached();

  if (!allowedUsers.size) {
    return { ok: false, reason: 'no_allowlist' };
  }

  if (!allowedUsers.has(message.author.id)) {
    return { ok: false, reason: 'user' };
  }

  const guildRaw =
    process.env.DISCORD_ALLOWED_GUILD_IDS?.trim() ||
    process.env.DISCORD_GUILD_ID?.trim();
  if (message.guild && guildRaw) {
    const allowedGuilds = new Set(
      guildRaw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    if (allowedGuilds.size && !allowedGuilds.has(message.guild.id)) {
      return { ok: false, reason: 'guild' };
    }
  }

  return { ok: true };
}

function formatWithBadge(intent, text) {
  const badge = INTENT_BADGES[intent] || '💬';
  return `${badge} ${text}`;
}

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

async function handleDiscordMessage(message, client) {
  const sessionId = getSessionId(message.author.id);
  const userText = stripMention(message.content, client);

  if (!userText) return;

  const history = await getHistory(sessionId);

  let llmCreds = { fromUser: false };
  if (isMongoReady()) {
    try {
      const linked = await User.findOne({
        'settings.discordUserId': String(message.author.id),
      }).lean();
      if (linked) {
        llmCreds = credsFromUserDoc(linked);
      }
    } catch {
      /* use env fallback */
    }
  }

  const turn = await runWithLlmCredentials(llmCreds, () =>
    withTyping(message.channel, () =>
      runChatTurn({
        message: userText,
        history,
        sessionId,
        channel: 'discord',
      })
    )
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

  client.once(Events.ClientReady, async (c) => {
    console.log(`[discord] bot online as ${c.user.tag}`);
    const allowed = await getAllowlistCached();
    if (allowed.size) {
      console.log(`[discord] allowlist: ${[...allowed].join(', ')} (${allowed.size} user(s))`);
    } else {
      console.warn(
        '[discord] WARNING: no Discord user IDs in Settings — bot will reject chats until configured'
      );
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!shouldRespond(message, client)) return;

    const auth = await isAuthorizedDiscordUser(message);
    if (!auth.ok) {
      console.log(
        `[discord] blocked ${auth.reason} — user ${message.author.id}` +
          (message.guild ? ` guild ${message.guild.id}` : ' (DM)')
      );
      if (process.env.DISCORD_AUTH_SILENT !== 'true') {
        try {
          const tip =
            auth.reason === 'no_allowlist'
              ? '🔒 Bot not configured. Owner: open Settings on the web app and set your Discord User ID.'
              : '🔒 Not authorized. This bot is private.';
          await message.reply({
            content: tip,
            allowedMentions: { repliedUser: false },
          });
        } catch {
          /* ignore */
        }
      }
      return;
    }

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
        /* ignore */
      }
    }
  });

  client.on('error', (err) => {
    console.error('[discord] client error:', err.message);
  });

  await client.login(token);
}
