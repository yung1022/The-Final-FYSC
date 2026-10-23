const { getSessionFromRequest } = require('../lib/discord-auth');
const { displayedSubscribers, offlineGrowthAt } = require('../../lib/offline-growth');

const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');

function firebaseUrl(path = '') {
  if (!FIREBASE_URL) {
    return null;
  }

  const cleanPath = String(path || '').replace(/^\/+/, '');
  return `${FIREBASE_URL}/${cleanPath}.json`;
}

function normalizeStats(data) {
  if (!data || typeof data !== 'object') return null;

  const subscribers = Number(data.subscribers ?? data.subscriberCount ?? data.subs ?? 0);
  const growth = Number(data.growth ?? data.growthCount ?? data.growthValue ?? 0);
  const video = Number(data.video ?? data.videoCount ?? 0);
  const short = Number(data.short ?? data.shortCount ?? 0);
  const offlineDuration = Number(data.offlineduration ?? 0);
  const now = Math.floor(Date.now() / 1000);

  return {
    subscribers: Number.isFinite(subscribers) ? Math.round(displayedSubscribers({ subscribers, growth, offlineduration: offlineDuration }, now)) : 0,
    growth: Number.isFinite(growth) ? Math.round(offlineGrowthAt(growth, offlineDuration, now)) : 0,
    video: Number.isFinite(video) ? video : 0,
    short: Number.isFinite(short) ? short : 0,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const session = getSessionFromRequest(req);
    if (!session || !session.discordUserId) {
      res.writeHead(200);
      res.end(JSON.stringify({ session: null, stats: null }));
      return;
    }

    let stats = null;
    const path = firebaseUrl(`leaderboard/${encodeURIComponent(session.discordUserId)}`);

    if (path) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const data = await response.json();
          stats = normalizeStats(data);
        }
      } catch (error) {
        stats = null;
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      session: {
        discordUserId: session.discordUserId,
        discordUsername: session.discordUsername || null,
        avatar: session.avatar || null,
        connectedAt: session.connectedAt || null,
      },
      stats,
    }));
  } catch (error) {
    res.writeHead(200);
    res.end(JSON.stringify({ session: null, stats: null, error: 'Discord session unavailable' }));
  }
};
