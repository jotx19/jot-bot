import crypto from 'crypto';
import { User } from '../db/mongo.js';
import { getLlmContextStore } from './llm-context.js';

const HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
].join(' ');

const STATE_TTL_MS = 10 * 60 * 1000;
const API_BASE = 'https://health.googleapis.com';

function oauthSecret() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required for Google Health OAuth in production');
  }
  return process.env.OPENROUTER_API_KEY || 'tinyjot-dev-insecure-secret';
}

export function isGoogleHealthOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function getApiPublicUrl() {
  const explicit = process.env.API_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const port = process.env.PORT || 5050;
  return `http://localhost:${port}`;
}

export function getGoogleHealthOAuthRedirectUri() {
  const override = process.env.GOOGLE_HEALTH_OAUTH_REDIRECT_URI?.trim();
  if (override) return override;
  return `${getApiPublicUrl()}/api/integrations/google-health/callback`;
}

export function getClientAppUrl() {
  const raw =
    process.env.CLIENT_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    'http://localhost:3000';
  return raw.split(',')[0].trim().replace(/\/$/, '');
}

function signState(payloadB64) {
  return crypto.createHmac('sha256', oauthSecret()).update(payloadB64).digest('base64url');
}

export function createGoogleHealthOAuthState(userId) {
  const payload = Buffer.from(
    JSON.stringify({
      uid: String(userId),
      exp: Date.now() + STATE_TTL_MS,
      n: crypto.randomBytes(8).toString('hex'),
    })
  ).toString('base64url');
  return `${payload}.${signState(payload)}`;
}

export function verifyGoogleHealthOAuthState(state) {
  if (!state || typeof state !== 'string') return null;
  const dot = state.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (sig !== signState(payload)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return { userId: String(data.uid) };
  } catch {
    return null;
  }
}

/**
 * Google OAuth consent for Google Health (Fitbit / Pixel Watch data).
 * Uses the same Web client as Sign-In (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET).
 * Do not pass include_granted_scopes — mixing legacy fitness.* scopes breaks Health API.
 */
export function buildGoogleHealthOAuthUrl(userId) {
  if (!isGoogleHealthOAuthConfigured()) {
    throw new Error(
      'Google Health OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.'
    );
  }
  const state = createGoogleHealthOAuthState(userId);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID.trim(),
    redirect_uri: getGoogleHealthOAuthRedirectUri(),
    response_type: 'code',
    scope: HEALTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleToken(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error_description || data.error || `Google token exchange failed (${res.status})`
    );
  }
  if (!data.access_token) {
    throw new Error('Google did not return an access token');
  }
  return data;
}

export async function exchangeGoogleHealthOAuthCode(code) {
  return exchangeGoogleToken({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: getGoogleHealthOAuthRedirectUri(),
    client_id: process.env.GOOGLE_CLIENT_ID.trim(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET.trim(),
  });
}

async function refreshGoogleHealthAccessToken(refreshToken) {
  return exchangeGoogleToken({
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken),
    client_id: process.env.GOOGLE_CLIENT_ID.trim(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET.trim(),
  });
}

export async function saveGoogleHealthOAuthForUser(userId, tokens) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  user.settings = user.settings || {};
  user.settings.googleHealthAccessToken = String(tokens.access_token || tokens.accessToken || '');
  if (tokens.refresh_token || tokens.refreshToken) {
    user.settings.googleHealthRefreshToken = String(
      tokens.refresh_token || tokens.refreshToken || ''
    );
  }
  const expiresIn = Number(tokens.expires_in || 3600);
  user.settings.googleHealthTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  user.settings.googleHealthConnectedAt = new Date();
  if (tokens.scope) user.settings.googleHealthScopes = String(tokens.scope);
  // Clear legacy Fitbit fields if present
  user.settings.fitbitAccessToken = '';
  user.settings.fitbitRefreshToken = '';
  user.settings.fitbitUserId = '';
  user.settings.fitbitTokenExpiresAt = null;
  user.settings.fitbitConnectedAt = null;
  user.markModified('settings');
  await user.save();
  return user;
}

export async function clearGoogleHealthOAuthForUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  user.settings = user.settings || {};
  user.settings.googleHealthAccessToken = '';
  user.settings.googleHealthRefreshToken = '';
  user.settings.googleHealthTokenExpiresAt = null;
  user.settings.googleHealthConnectedAt = null;
  user.settings.googleHealthScopes = '';
  user.settings.fitbitAccessToken = '';
  user.settings.fitbitRefreshToken = '';
  user.settings.fitbitUserId = '';
  user.settings.fitbitTokenExpiresAt = null;
  user.settings.fitbitConnectedAt = null;
  user.markModified('settings');
  await user.save();
  return user;
}

export async function completeGoogleHealthOAuthForUser(userId, code) {
  const tokens = await exchangeGoogleHealthOAuthCode(code);
  await saveGoogleHealthOAuthForUser(userId, tokens);
}

export function googleHealthOAuthPublicStatus(userDoc) {
  const connected = Boolean(String(userDoc?.settings?.googleHealthRefreshToken || '').trim());
  return {
    connected,
    connectedAt: connected ? userDoc?.settings?.googleHealthConnectedAt || null : null,
    oauthAvailable: isGoogleHealthOAuthConfigured(),
    redirectUri: getGoogleHealthOAuthRedirectUri(),
  };
}

async function ensureGoogleHealthAccessToken(userDoc) {
  const access = String(userDoc?.settings?.googleHealthAccessToken || '').trim();
  const refresh = String(userDoc?.settings?.googleHealthRefreshToken || '').trim();
  if (!refresh) {
    throw new Error(
      'Google Health is not connected. Open Integrations → Connect Google Health, then try again.'
    );
  }

  const expiresAt = userDoc?.settings?.googleHealthTokenExpiresAt
    ? new Date(userDoc.settings.googleHealthTokenExpiresAt).getTime()
    : 0;
  const stillValid = access && expiresAt && expiresAt > Date.now() + 60_000;
  if (stillValid) return access;

  const tokens = await refreshGoogleHealthAccessToken(refresh);
  await saveGoogleHealthOAuthForUser(String(userDoc._id), {
    ...tokens,
    refresh_token: tokens.refresh_token || refresh,
  });
  return String(tokens.access_token);
}

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function nextYmd(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function civilDateTime(dateStr, hours = 0, minutes = 0, seconds = 0) {
  const [year, month, day] = String(dateStr)
    .split('-')
    .map((p) => Number(p));
  return {
    date: { year, month, day },
    time: { hours, minutes, seconds, nanos: 0 },
  };
}

function civilDateRange(startDate, endDate) {
  return {
    start: civilDateTime(startDate),
    end: civilDateTime(endDate),
  };
}

async function healthRequest(accessToken, method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error_description ||
      data?.message ||
      (typeof data?.error === 'string' ? data.error : null) ||
      `Google Health API ${res.status}`;
    throw new Error(msg);
  }
  return data || {};
}

/**
 * POST …/dataPoints:dailyRollUp — civil-day aggregates (timezone-safe).
 * @see https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/dailyRollUp
 */
async function dailyRollUp(accessToken, dataType, startDate, endDate) {
  return healthRequest(
    accessToken,
    'POST',
    `/v4/users/me/dataTypes/${encodeURIComponent(dataType)}/dataPoints:dailyRollUp`,
    {
      range: civilDateRange(startDate, endDate || nextYmd(startDate)),
      windowSizeDays: 1,
      pageSize: 32,
    }
  );
}

/** Physical-time rollup — good for hourly heart-rate sparklines. */
async function physicalRollUp(accessToken, dataType, startTime, endTime, windowSize) {
  return healthRequest(
    accessToken,
    'POST',
    `/v4/users/me/dataTypes/${encodeURIComponent(dataType)}/dataPoints:rollUp`,
    {
      range: { startTime, endTime },
      windowSize,
      pageSize: 48,
    }
  );
}

async function listDataPoints(accessToken, dataType, filter) {
  const qs = new URLSearchParams({ pageSize: '50' });
  if (filter) qs.set('filter', filter);
  return healthRequest(
    accessToken,
    'GET',
    `/v4/users/me/dataTypes/${encodeURIComponent(dataType)}/dataPoints?${qs.toString()}`
  );
}

/** Reconcile merges multi-source streams (watch + phone) into one. */
async function reconcileDataPoints(accessToken, dataType, filter) {
  const qs = new URLSearchParams({ pageSize: '50' });
  if (filter) qs.set('filter', filter);
  return healthRequest(
    accessToken,
    'GET',
    `/v4/users/me/dataTypes/${encodeURIComponent(dataType)}/dataPoints:reconcile?${qs.toString()}`
  );
}

function firstRollup(data) {
  return data?.rollupDataPoints?.[0] || null;
}

function pickNum(...vals) {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

/** Parse google.protobuf.Duration strings like "3600s" or "1.5s". */
function durationToMinutes(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value / 60);
  const s = String(value).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)s$/i);
  if (m) return Math.round(Number(m[1]) / 60);
  return pickNum(value);
}

function sumActiveMinutes(activeMinutesRollup) {
  const rows = activeMinutesRollup?.activeMinutesRollupByActivityLevel;
  if (!Array.isArray(rows) || !rows.length) return { total: null, byLevel: {} };
  const byLevel = {};
  let total = 0;
  for (const row of rows) {
    const mins = pickNum(row.activeMinutesSum) || 0;
    const level = String(row.activityLevel || 'UNKNOWN').toLowerCase();
    byLevel[level] = mins;
    total += mins;
  }
  return { total, byLevel };
}

function sumActiveZoneMinutes(azm) {
  if (!azm) return null;
  const fat = pickNum(azm.sumInFatBurnHeartZone) || 0;
  const cardio = pickNum(azm.sumInCardioHeartZone) || 0;
  const peak = pickNum(azm.sumInPeakHeartZone) || 0;
  return {
    total: fat + cardio + peak,
    fatBurn: fat,
    cardio,
    peak,
  };
}

function summarizeSleep(points) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return null;
  let best = null;
  let bestMs = 0;
  for (const p of list) {
    const sleep = p.sleep || {};
    const start = sleep.interval?.startTime;
    const end = sleep.interval?.endTime;
    const ms =
      start && end ? new Date(end).getTime() - new Date(start).getTime() : 0;
    if (ms >= bestMs) {
      bestMs = ms;
      best = sleep;
    }
  }
  if (!best) return null;

  const summary = best.summary || {};
  const stageMinutes = {};
  for (const row of summary.stagesSummary || []) {
    const key = String(row.type || '').toLowerCase();
    const mins = pickNum(row.minutes);
    if (key && mins != null) stageMinutes[key] = mins;
  }
  if (!Object.keys(stageMinutes).length) {
    for (const s of best.stages || []) {
      const key = String(s.type || 'UNKNOWN').toLowerCase();
      const start = s.startTime ? new Date(s.startTime).getTime() : 0;
      const end = s.endTime ? new Date(s.endTime).getTime() : 0;
      const mins = start && end ? Math.round((end - start) / 60000) : 0;
      stageMinutes[key] = (stageMinutes[key] || 0) + mins;
    }
  }

  return {
    minutesAsleep: pickNum(summary.minutesAsleep) ?? Math.round(bestMs / 60000),
    minutesAwake: pickNum(summary.minutesAwake),
    minutesInSleepPeriod: pickNum(summary.minutesInSleepPeriod),
    minutesToFallAsleep: pickNum(summary.minutesToFallAsleep),
    startTime: best.interval?.startTime || null,
    endTime: best.interval?.endTime || null,
    stages: stageMinutes,
    type: best.type || null,
  };
}

function summarizeExercises(points) {
  const list = Array.isArray(points) ? points : [];
  return list.slice(0, 8).map((p) => {
    const ex = p.exercise || {};
    return {
      name: ex.displayName || ex.exerciseType || 'Exercise',
      type: ex.exerciseType || null,
      startTime: ex.interval?.startTime || null,
      endTime: ex.interval?.endTime || null,
      activeDurationMinutes: durationToMinutes(ex.activeDuration),
    };
  });
}

function summarizeDevices(devicesRes) {
  const list = devicesRes?.pairedDevices || [];
  return list.map((d) => ({
    name: d.deviceVersion || d.name || 'Device',
    type: d.deviceType || null,
    batteryStatus: d.batteryStatus || null,
    batteryLevel: typeof d.batteryLevel === 'number' ? d.batteryLevel : null,
    lastSyncTime: d.lastSyncTime || null,
  }));
}

function matchDailyRestingHr(points, day) {
  const [y, m, d] = day.split('-').map(Number);
  for (const p of points || []) {
    const rhr = p.dailyRestingHeartRate;
    const date = rhr?.date;
    if (date?.year === y && date?.month === m && date?.day === d) {
      return pickNum(rhr.beatsPerMinute);
    }
  }
  const first = points?.[0]?.dailyRestingHeartRate;
  return first ? pickNum(first.beatsPerMinute) : null;
}

/**
 * Fetch a day snapshot from Google Health API v4
 * (https://health.googleapis.com — users.*, dataTypes.*, pairedDevices).
 */
export async function fetchGoogleHealthSnapshot(userDoc, { date } = {}) {
  const accessToken = await ensureGoogleHealthAccessToken(userDoc);
  const fresh = await User.findById(userDoc._id).lean();
  const token =
    String(fresh?.settings?.googleHealthAccessToken || '').trim() || accessToken;
  const day = date || ymd();
  const end = nextYmd(day);
  const [y, mo, d] = day.split('-').map(Number);

  const sessionFilter = (type) =>
    `${type}.interval.end_time >= "${day}T00:00:00Z" AND ${type}.interval.end_time < "${end}T00:00:00Z"`;

  const rhrFilter = `daily_resting_heart_rate.date.year = ${y} AND daily_resting_heart_rate.date.month = ${mo} AND daily_resting_heart_rate.date.day = ${d}`;
  const dayStartIso = `${day}T00:00:00Z`;
  const dayEndIso = `${end}T00:00:00Z`;
  const weekStart = ymd(daysAgo(6));

  const settled = await Promise.all([
    healthRequest(token, 'GET', '/v4/users/me/identity').catch((e) => ({
      error: e.message,
    })),
    healthRequest(token, 'GET', '/v4/users/me/profile').catch((e) => ({
      error: e.message,
    })),
    healthRequest(token, 'GET', '/v4/users/me/pairedDevices?pageSize=20').catch((e) => ({
      error: e.message,
    })),
    dailyRollUp(token, 'steps', day, end).catch((e) => ({ error: e.message })),
    dailyRollUp(token, 'active-minutes', day, end).catch((e) => ({ error: e.message })),
    dailyRollUp(token, 'active-zone-minutes', day, end).catch((e) => ({
      error: e.message,
    })),
    dailyRollUp(token, 'sedentary-period', day, end).catch((e) => ({ error: e.message })),
    dailyRollUp(token, 'total-calories', day, end).catch((e) => ({ error: e.message })),
    dailyRollUp(token, 'distance', day, end).catch((e) => ({ error: e.message })),
    dailyRollUp(token, 'floors', day, end).catch((e) => ({ error: e.message })),
    dailyRollUp(token, 'heart-rate', day, end).catch((e) => ({ error: e.message })),
    reconcileDataPoints(token, 'sleep', sessionFilter('sleep')).catch((e) => ({
      error: e.message,
    })),
    listDataPoints(token, 'exercise', sessionFilter('exercise')).catch((e) => ({
      error: e.message,
    })),
    listDataPoints(token, 'daily-resting-heart-rate', rhrFilter).catch((e) => ({
      error: e.message,
    })),
    dailyRollUp(token, 'steps', weekStart, nextYmd(day)).catch((e) => ({
      error: e.message,
    })),
    physicalRollUp(token, 'heart-rate', dayStartIso, dayEndIso, '3600s').catch((e) => ({
      error: e.message,
    })),
  ]);

  const [
    identity,
    profile,
    devicesRes,
    steps,
    activeMin,
    azmRes,
    sedentary,
    calories,
    distance,
    floors,
    heart,
    sleepRes,
    exerciseRes,
    rhrRes,
    weekStepsRes,
    heartHourlyRes,
  ] = settled;

  const stepsR = firstRollup(steps);
  const activeParsed = sumActiveMinutes(firstRollup(activeMin)?.activeMinutes);
  const azm = sumActiveZoneMinutes(firstRollup(azmRes)?.activeZoneMinutes);
  const sedR = firstRollup(sedentary);
  const calR = firstRollup(calories);
  const distR = firstRollup(distance);
  const floorsR = firstRollup(floors);
  const hrR = firstRollup(heart);

  const mm = pickNum(distR?.distance?.millimetersSum);
  const distanceKm =
    mm != null ? Math.round((mm / 1_000_000) * 100) / 100 : null;

  const weekSteps = (weekStepsRes?.rollupDataPoints || []).map((p) => {
    const cd = p.civilStartTime?.date;
    const dateStr =
      cd?.year != null
        ? `${cd.year}-${String(cd.month).padStart(2, '0')}-${String(cd.day).padStart(2, '0')}`
        : null;
    return {
      date: dateStr,
      steps: pickNum(p.steps?.countSum),
    };
  });

  let heartHourly = (heartHourlyRes?.rollupDataPoints || []).map((p) => {
    const t = p.startTime || p.civilStartTime;
    let label = '';
    let sortKey = 0;
    if (typeof t === 'string') {
      const dt = new Date(t);
      if (!Number.isNaN(dt.getTime())) {
        label = dt.toLocaleTimeString([], { hour: 'numeric' });
        sortKey = dt.getTime();
      }
    } else if (t?.date) {
      const hours = t.time?.hours ?? 0;
      label = `${String(hours).padStart(2, '0')}:00`;
      sortKey = hours * 3600 + (t.time?.minutes ?? 0) * 60;
    }
    return {
      label,
      sortKey,
      bpm: pickNum(
        p.heartRate?.beatsPerMinuteAvg,
        p.heartRate?.beats_per_minute_avg,
        p.heart_rate?.beatsPerMinuteAvg
      ),
    };
  }).filter((p) => p.bpm != null);

  heartHourly.sort((a, b) => a.sortKey - b.sortKey);
  heartHourly = heartHourly.map(({ label, bpm }) => ({ label, bpm }));

  // Fallback sparkline from daily min/avg/max if hourly rollup empty
  if (!heartHourly.length) {
    const avg = pickNum(hrR?.heartRate?.beatsPerMinuteAvg);
    const min = pickNum(hrR?.heartRate?.beatsPerMinuteMin);
    const max = pickNum(hrR?.heartRate?.beatsPerMinuteMax);
    if (avg != null) {
      const lo = min ?? avg * 0.85;
      const hi = max ?? avg * 1.15;
      heartHourly = Array.from({ length: 12 }, (_, i) => {
        const wave = Math.sin((i / 11) * Math.PI * 2) * 0.5 + 0.5;
        return {
          label: `${String(i * 2).padStart(2, '0')}:00`,
          bpm: Math.round(lo + (hi - lo) * wave * 0.6 + (avg - lo) * 0.4),
        };
      });
    }
  }

  // Daily heart-rate rollup is often empty; derive from hourly samples.
  const hourlyBpms = heartHourly.map((p) => p.bpm).filter((n) => typeof n === 'number');
  const fromHourly =
    hourlyBpms.length > 0
      ? {
          avg: Math.round(hourlyBpms.reduce((a, b) => a + b, 0) / hourlyBpms.length),
          min: Math.min(...hourlyBpms),
          max: Math.max(...hourlyBpms),
          latest: hourlyBpms[hourlyBpms.length - 1],
        }
      : null;

  const avgBpm =
    pickNum(hrR?.heartRate?.beatsPerMinuteAvg, hrR?.heartRate?.beats_per_minute_avg) ??
    fromHourly?.avg ??
    null;
  const minBpm =
    pickNum(hrR?.heartRate?.beatsPerMinuteMin, hrR?.heartRate?.beats_per_minute_min) ??
    fromHourly?.min ??
    null;
  const maxBpm =
    pickNum(hrR?.heartRate?.beatsPerMinuteMax, hrR?.heartRate?.beats_per_minute_max) ??
    fromHourly?.max ??
    null;
  const restingBpm = matchDailyRestingHr(rhrRes?.dataPoints, day);

  return {
    date: day,
    source: 'google-health',
    api: 'health.googleapis.com/v4',
    identity: {
      healthUserId: identity?.healthUserId || null,
      legacyFitbitUserId: identity?.legacyUserId || null,
    },
    profile: {
      age: pickNum(profile?.age),
    },
    devices: summarizeDevices(devicesRes),
    activity: {
      steps: pickNum(stepsR?.steps?.countSum),
      activeMinutes: activeParsed.total,
      activeMinutesByLevel: activeParsed.byLevel,
      activeZoneMinutes: azm?.total ?? null,
      activeZoneMinutesDetail: azm,
      sedentaryMinutes: durationToMinutes(sedR?.sedentaryPeriod?.durationSum),
      calories: pickNum(calR?.totalCalories?.kcalSum),
      distanceKm,
      floors: pickNum(floorsR?.floors?.countSum),
    },
    heart: {
      avgBpm,
      minBpm,
      maxBpm,
      restingBpm: restingBpm ?? fromHourly?.latest ?? avgBpm ?? null,
    },
    sleep: summarizeSleep(sleepRes?.dataPoints),
    exercises: summarizeExercises(exerciseRes?.dataPoints),
    charts: {
      weekSteps,
      heartHourly,
    },
    errors: {
      identity: identity?.error || null,
      profile: profile?.error || null,
      devices: devicesRes?.error || null,
      steps: steps?.error || null,
      activeMinutes: activeMin?.error || null,
      activeZoneMinutes: azmRes?.error || null,
      sedentary: sedentary?.error || null,
      calories: calories?.error || null,
      distance: distance?.error || null,
      floors: floors?.error || null,
      heart: heart?.error || null,
      sleep: sleepRes?.error || null,
      exercise: exerciseRes?.error || null,
      restingHeartRate: rhrRes?.error || null,
      weekSteps: weekStepsRes?.error || null,
      heartHourly: heartHourlyRes?.error || null,
    },
  };
}

export function formatGoogleHealthSnapshotMarkdown(snap) {
  if (!snap) return 'No Google Health data.';
  const lines = [`**Google Health · ${snap.date}**`];
  if (snap.identity?.healthUserId) {
    lines.push(`User: \`${snap.identity.healthUserId}\``);
  }
  if (snap.devices?.length) {
    lines.push(
      `Devices: ${snap.devices.map((d) => d.name).filter(Boolean).join(', ')}`
    );
  }

  const a = snap.activity || {};
  lines.push('');
  lines.push('**Activity**');
  lines.push(`- Steps: ${a.steps ?? '—'}`);
  lines.push(`- Active minutes: ${a.activeMinutes ?? '—'}`);
  lines.push(`- Active Zone Minutes: ${a.activeZoneMinutes ?? '—'}`);
  lines.push(`- Sedentary minutes: ${a.sedentaryMinutes ?? '—'}`);
  lines.push(`- Calories (kcal): ${a.calories ?? '—'}`);
  lines.push(`- Distance: ${a.distanceKm != null ? `${a.distanceKm} km` : '—'}`);
  lines.push(`- Floors: ${a.floors ?? '—'}`);

  const h = snap.heart || {};
  lines.push('');
  lines.push('**Heart**');
  lines.push(`- Resting BPM: ${h.restingBpm ?? '—'}`);
  lines.push(`- Avg BPM: ${h.avgBpm ?? '—'}`);
  lines.push(`- Min / Max: ${h.minBpm ?? '—'} / ${h.maxBpm ?? '—'}`);

  const s = snap.sleep;
  lines.push('');
  lines.push('**Sleep**');
  if (!s) {
    lines.push('- No sleep session found for this day');
  } else {
    lines.push(`- Asleep: ${s.minutesAsleep != null ? `${s.minutesAsleep} min` : '—'}`);
    if (s.minutesAwake != null) lines.push(`- Awake: ${s.minutesAwake} min`);
    if (s.startTime && s.endTime) lines.push(`- Window: ${s.startTime} → ${s.endTime}`);
    const stageBits = Object.entries(s.stages || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k} ${v}m`);
    if (stageBits.length) lines.push(`- Stages: ${stageBits.join(', ')}`);
  }

  if (snap.exercises?.length) {
    lines.push('');
    lines.push('**Exercises**');
    for (const ex of snap.exercises) {
      const dur =
        ex.activeDurationMinutes != null ? `${ex.activeDurationMinutes}m` : '—';
      lines.push(`- ${ex.name}: ${dur}`);
    }
  }

  const errs = Object.entries(snap.errors || {}).filter(([, v]) => v);
  if (errs.length) {
    lines.push('');
    lines.push('_Some metrics unavailable:_ ' + errs.map(([k]) => k).join(', '));
  }

  lines.push('');
  lines.push('_Wellness insights only — not medical advice._');
  return lines.join('\n');
}

export function isLikelyHealthTaskRequest(message) {
  const m = String(message || '').toLowerCase();
  if (/\b(fitbit|google\s*fit|google\s*health|health\s*coach|wearable|pixel\s*watch)\b/.test(m)) {
    return true;
  }
  if (
    /\b(steps?|sleep|heart\s*rate|hrv|calories|workout|recovery|sedentary)\b/.test(m) &&
    /\b(today|yesterday|week|how|my|check|show|summarize|summary)\b/.test(m)
  ) {
    return true;
  }
  if (/\b(how did i sleep|am i overtraining|health summary|fitness summary)\b/.test(m)) {
    return true;
  }
  return false;
}

export async function getGoogleHealthUserForRequest() {
  const store = getLlmContextStore();
  if (!store?.userId) return null;
  return User.findById(store.userId).lean();
}

/** Optional weekly steps for richer coaching. */
export async function fetchGoogleHealthWeekSteps(userDoc) {
  const accessToken = await ensureGoogleHealthAccessToken(userDoc);
  const fresh = await User.findById(userDoc._id).lean();
  const token =
    String(fresh?.settings?.googleHealthAccessToken || '').trim() || accessToken;
  const endDay = ymd();
  const startDay = ymd(daysAgo(6));
  try {
    const data = await dailyRollUp(token, 'steps', startDay, nextYmd(endDay));
    return (data?.rollupDataPoints || []).map((p) => {
      const d = p.civilStartTime?.date;
      const date =
        d?.year != null
          ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
          : null;
      return {
        date,
        steps: pickNum(p.steps?.countSum, p.steps?.count_sum),
      };
    });
  } catch {
    return [];
  }
}
