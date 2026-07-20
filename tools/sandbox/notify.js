import fetch from 'node-fetch';
import { getNotifyTargets } from '../../core/users.js';

const DISCORD_MAX = 1900;

function clip(text, max = DISCORD_MAX) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 20)}\n…(truncated)`;
}

export function formatSchedulerPing({ name, result, error, discordUserId }) {
  const lines = [];
  if (discordUserId) lines.push(`<@${discordUserId}>`);
  lines.push(`⏱ **Scheduler:** \`${name}\``);

  if (error) {
    lines.push(`Status: failed`);
    lines.push(`Error: ${clip(error, 500)}`);
    return lines.join('\n');
  }

  const exitCode = result?.exitCode ?? 0;
  const timedOut = result?.timedOut;
  lines.push(
    `Status: ${timedOut ? 'timed out' : exitCode === 0 ? 'ok' : `exit ${exitCode}`}`
  );

  const out = clip(result?.stdout);
  const err = clip(result?.stderr, 800);
  if (out) lines.push(`\n**Output:**\n\`\`\`\n${out}\n\`\`\``);
  if (err && exitCode !== 0) lines.push(`\n**Stderr:**\n\`\`\`\n${err}\n\`\`\``);
  if (!out && !err) lines.push('_No output_');

  return lines.join('\n').slice(0, 2000);
}

async function postToChannel(token, channelId, content, mentionUserIds = []) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify({
        content: String(content).slice(0, 2000),
        allowed_mentions: {
          parse: [],
          users: mentionUserIds.filter(Boolean),
        },
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[notify] channel ${channelId} HTTP ${res.status}: ${errText.slice(0, 200)}`);
    return false;
  }
  return true;
}

/**
 * Ping all configured user notify channels after a scheduled run.
 */
export async function notifySchedulerRun(name, result, error = null) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    console.warn('[notify] skipped — DISCORD_BOT_TOKEN not set');
    return false;
  }

  const targets = await getNotifyTargets();
  if (!targets.length) {
    console.warn('[notify] skipped — no notify channels in Settings or .env');
    return false;
  }

  const emptyOk =
    !error &&
    result &&
    result.exitCode === 0 &&
    !result.timedOut &&
    !String(result.stdout || '').trim() &&
    !String(result.stderr || '').trim();

  let sent = 0;
  for (const t of targets) {
    if (emptyOk && !t.notifyAlways) continue;

    const content = formatSchedulerPing({
      name,
      result,
      error,
      discordUserId: t.discordUserId,
    });

    try {
      const ok = await postToChannel(
        token,
        t.channelId,
        content,
        t.discordUserId ? [t.discordUserId] : []
      );
      if (ok) sent++;
    } catch (err) {
      console.warn('[notify] failed:', err.message);
    }
  }

  if (sent) console.log(`[notify] sent scheduler ping for ${name} → ${sent} channel(s)`);
  return sent > 0;
}

export async function isNotifyConfigured() {
  if (!process.env.DISCORD_BOT_TOKEN?.trim()) return false;
  const targets = await getNotifyTargets();
  return targets.length > 0;
}

/** @deprecated kept for one-off tests */
export async function notifyDiscord(content) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const targets = await getNotifyTargets();
  if (!token || !targets.length) return false;
  let ok = false;
  for (const t of targets) {
    const text = t.discordUserId
      ? `<@${t.discordUserId}>\n${content}`
      : content;
    const sent = await postToChannel(
      token,
      t.channelId,
      text,
      t.discordUserId ? [t.discordUserId] : []
    );
    if (sent) ok = true;
  }
  return ok;
}
