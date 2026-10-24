const { offlineGrowthAt, currentUnixTime } = require('../../../lib/offline-growth');

const MIN_YT_GROWTH = 1000;
const MAX_YT_GROWTH = 5000;

function sanitizeNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

async function readLeaderboard() {
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
    const entry = value && typeof value === 'object' ? value : {};
    return { ...entry, userId: entry.userId || key };
  });
}

async function findUserByChannelId(channelId) {
  const cleanChannelId = String(channelId ?? '').trim();
  if (!cleanChannelId) return null;

  const entries = await readLeaderboard();
  const match = entries.find((entry) => {
    const storedId = String(entry?.ytid ?? entry?.youtubeChannelId ?? entry?.channelId ?? '').trim();
    return storedId === cleanChannelId;
  });

  if (!match) return null;

  return {
    ...match,
    ytgrowth: sanitizeNumber(match.ytgrowth, 0),
    tempsub: sanitizeNumber(match.tempsub, 0),
    ytofflineduration: sanitizeNumber(match.ytofflineduration, currentUnixTime()),
    userId: match.userId || null,
  };
}

async function saveUser(userId, entry) {
  const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');
  if (!FIREBASE_URL) {
    throw new Error('FIREBASE_DB_URL is not configured in Vercel');
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const url = new URL(req.url, 'https://example.com');
  const channelId = url.pathname.split('/').filter(Boolean).pop();

  if (!channelId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'channelId is required' }));
    return;
  }

  try {
    const user = await findUserByChannelId(channelId);
    if (!user || !user.userId) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'channelId not found for any Discord-linked user' }));
      return;
    }

    const now = currentUnixTime();
    const previousYtGrowth = sanitizeNumber(user.ytgrowth, 0);
    const previousTempsub = sanitizeNumber(user.tempsub, 0);
    const previousOfflineduration = sanitizeNumber(user.ytofflineduration, now);
    const baseForGrowth = previousTempsub > 0 ? previousTempsub : previousYtGrowth;
    const addedGrowth = MIN_YT_GROWTH + Math.random() * (MAX_YT_GROWTH - MIN_YT_GROWTH);
    const tempSubGain = offlineGrowthAt(baseForGrowth, previousOfflineduration, now);

    const next = {
      ...user,
      userId: user.userId,
      ytid: channelId,
      ytgrowth: previousYtGrowth + addedGrowth,
      tempsub: previousTempsub + tempSubGain,
      ytofflineduration: now,
      updatedAt: new Date().toISOString(),
    };

    const saved = await saveUser(user.userId, next);

    res.writeHead(200);
    res.end(JSON.stringify({
      channelId,
      userId: user.userId,
      addedGrowth,
      currentYtGrowth: saved.ytgrowth,
      subGain: Number(tempSubGain),
      tempsub: Number(saved.tempsub),
      ytofflineduration: Number(saved.ytofflineduration),
    }));
  } catch (error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: error.message || 'Failed to process yt post' }));
  }
};
