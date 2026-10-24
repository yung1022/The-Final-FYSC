const { offlineGrowthAt, currentUnixTime } = require('../../../lib/offline-growth');

function sanitizeNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeEntry(entry, userId) {
  if (!entry || typeof entry !== 'object') return null;
  const next = { ...entry };
  if (userId != null && next.userId == null) next.userId = userId;

  next.ytgrowth = sanitizeNumber(next.ytgrowth, 0);
  next.tempsub = sanitizeNumber(next.tempsub, 0);
  next.ytofflineduration = sanitizeNumber(next.ytofflineduration, currentUnixTime());

  if (next.ytgrowth < 0) next.ytgrowth = 0;
  if (next.tempsub < 0) next.tempsub = 0;
  if (next.ytofflineduration <= 0) next.ytofflineduration = currentUnixTime();

  return next;
}

function applyYtGrowth(entry, extraGrowth = 0) {
  const next = normalizeEntry(entry, entry?.userId ?? null);
  const now = currentUnixTime();
  const previousGrowth = offlineGrowthAt(next.ytgrowth, next.ytofflineduration, now);
  const previousTempSub = offlineGrowthAt(next.tempsub, next.ytofflineduration, now);

  next.ytgrowth = sanitizeNumber(next.ytgrowth) + sanitizeNumber(extraGrowth, 0);
  next.tempsub = sanitizeNumber(next.tempsub) + previousTempSub;
  next.ytofflineduration = now;

  return {
    ...next,
    previousGrowth,
    previousTempSub,
  };
}

async function getLeaderboardEntries() {
  const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');
  if (!FIREBASE_URL) {
    throw new Error('FIREBASE_DB_URL is not configured in Vercel');
  }

  const response = await fetch(`${FIREBASE_URL}/leaderboard.json`);
  if (!response.ok) {
    throw new Error(`Leaderboard lookup failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data) return [];

  return Object.entries(data).map(([key, value]) => {
    const item = value && typeof value === 'object' ? value : {};
    return { ...item, userId: item.userId || key };
  });
}

async function findUserByChannelId(channelId) {
  const cleanChannelId = String(channelId ?? '').trim();
  if (!cleanChannelId) return null;

  const entries = await getLeaderboardEntries();
  const match = entries.find((entry) => {
    const storedId = String(entry?.ytid ?? entry?.youtubeChannelId ?? entry?.channelId ?? '').trim();
    return storedId === cleanChannelId;
  });

  if (!match) return null;
  return normalizeEntry(match, match.userId);
}

async function saveEntry(entry) {
  const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');
  if (!FIREBASE_URL) {
    throw new Error('FIREBASE_DB_URL is not configured in Vercel');
  }

  const userId = String(entry?.userId ?? '').trim();
  if (!userId) {
    throw new Error('Missing userId while saving yt growth data');
  }

  const response = await fetch(`${FIREBASE_URL}/leaderboard/${encodeURIComponent(userId)}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Update failed with HTTP ${response.status}`);
  }

  return entry;
}

module.exports = {
  normalizeEntry,
  applyYtGrowth,
  findUserByChannelId,
  saveEntry,
  currentUnixTime,
  offlineGrowthAt,
};
