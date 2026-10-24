const { offlineGrowthAt } = require('../../lib/offline-growth');

const MIN_YT_GROWTH = 1000;
const MAX_YT_GROWTH = 5000;

function currentUnixTime() {
  return Math.floor(Date.now() / 1000);
}

function randomYtGrowth() {
  return Math.floor(Math.random() * (MAX_YT_GROWTH - MIN_YT_GROWTH + 1)) + MIN_YT_GROWTH;
}

function sanitizeValue(value) {
  if (value == null || value === '') return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeEntry(entry, userId) {
  if (!entry || typeof entry !== 'object') return null;

  const normalized = { ...entry };
  if (normalized.userId == null && userId) {
    normalized.userId = userId;
  }

  normalized.ytgrowth = sanitizeValue(normalized.ytgrowth);
  normalized.tempsub = sanitizeValue(normalized.tempsub);
  normalized.ytofflineduration = sanitizeValue(normalized.ytofflineduration);

  if (normalized.ytgrowth <= 0) {
    normalized.ytgrowth = randomYtGrowth();
  }

  if (normalized.ytofflineduration <= 0) {
    normalized.ytofflineduration = currentUnixTime();
  }

  if (normalized.tempsub < 0) {
    normalized.tempsub = 0;
  }

  return normalized;
}

function applyOfflineGrowth(entry) {
  const now = currentUnixTime();
  const next = normalizeEntry(entry, entry?.userId ?? null);

  if (!next) return null;

  const growthDelta = offlineGrowthAt(next.ytgrowth, next.ytofflineduration, now);
  const tempSubDelta = offlineGrowthAt(next.tempsub, next.ytofflineduration, now);

  next.ytgrowth = sanitizeValue(next.ytgrowth) + growthDelta;
  next.tempsub = sanitizeValue(next.tempsub) + tempSubDelta;
  next.ytofflineduration = now;

  return next;
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
  currentUnixTime,
  randomYtGrowth,
  normalizeEntry,
  applyOfflineGrowth,
  findUserByChannelId,
  saveEntry,
  MIN_YT_GROWTH,
  MAX_YT_GROWTH,
};
