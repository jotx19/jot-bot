import { User, isMongoReady } from '../db/mongo.js';

/**
 * Users who may talk to the Discord bot (by Discord snowflake).
 * Merges DB settings + optional legacy DISCORD_ALLOWED_USER_IDS env.
 */
export async function getDiscordAllowlist() {
  const ids = new Set();

  const envIds = (process.env.DISCORD_ALLOWED_USER_IDS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of envIds) ids.add(id);

  if (isMongoReady()) {
    try {
      const users = await User.find({
        'settings.discordUserId': { $nin: [null, ''] },
      })
        .select('settings.discordUserId')
        .lean();
      for (const u of users) {
        const id = u.settings?.discordUserId?.trim();
        if (id) ids.add(id);
      }
    } catch (err) {
      console.warn('[users] allowlist load failed:', err.message);
    }
  }

  return ids;
}

/**
 * Notify targets from user settings (+ legacy env channel as fallback).
 * @returns {Promise<Array<{ channelId: string, discordUserId: string, notifyAlways: boolean }>>}
 */
export async function getNotifyTargets() {
  const targets = [];

  if (isMongoReady()) {
    try {
      const users = await User.find({
        'settings.notifyChannelId': { $nin: [null, ''] },
        'settings.notifyScheduler': { $ne: false },
      })
        .select('settings')
        .lean();

      for (const u of users) {
        const channelId = u.settings?.notifyChannelId?.trim();
        if (!channelId) continue;
        targets.push({
          channelId,
          discordUserId: u.settings?.discordUserId?.trim() || '',
          notifyAlways: Boolean(u.settings?.notifyAlways),
        });
      }
    } catch (err) {
      console.warn('[users] notify targets failed:', err.message);
    }
  }

  // Legacy .env fallback when no user configured notify yet
  if (!targets.length) {
    const channelId = process.env.DISCORD_NOTIFY_CHANNEL_ID?.trim();
    if (channelId && process.env.DISCORD_NOTIFY_SCHEDULER !== 'false') {
      const envUser = (process.env.DISCORD_ALLOWED_USER_IDS || '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)[0];
      targets.push({
        channelId,
        discordUserId: envUser || '',
        notifyAlways: process.env.DISCORD_NOTIFY_ALWAYS === 'true',
      });
    }
  }

  return targets;
}

export function normalizeDiscordId(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 32);
}

/**
 * OAuth invite link for “Add bot to Discord” in the web UI.
 * Prefer DISCORD_INVITE_URL; else DISCORD_CLIENT_ID; else decode app id from bot token.
 */
export function getDiscordInviteUrl() {
  const explicit = process.env.DISCORD_INVITE_URL?.trim();
  if (explicit) return explicit;

  let clientId =
    process.env.DISCORD_CLIENT_ID?.trim() ||
    process.env.DISCORD_APPLICATION_ID?.trim() ||
    '';

  if (!clientId) {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    if (token?.includes('.')) {
      try {
        clientId = Buffer.from(token.split('.')[0], 'base64').toString('utf8').trim();
      } catch {
        clientId = '';
      }
    }
  }

  if (!clientId || !/^\d{5,32}$/.test(clientId)) return null;

  // View Channel + Send Messages + Read Message History + Embed Links
  const permissions = '117760';
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=${permissions}&scope=bot`;
}
