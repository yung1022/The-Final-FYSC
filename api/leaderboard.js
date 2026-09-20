const { sortByDisplayedSubscribers } = require('../lib/offline-growth');

const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');
const FIREBASE_PATH = 'leaderboard';
const COUNTER_PATH = 'counter';
const TOP_LIMIT = 50;

function databaseUrl(path) {
  if (!FIREBASE_URL) {
    throw new Error('FIREBASE_DB_URL is not configured in Vercel');
  }

  return `${FIREBASE_URL}/${path}.json`;
}

/**
 * Rank every entry by its *displayed* subscriber count: the stored count plus
 * the offline growth accrued since `offlineduration`. The growth formula has to
 * run before the top 50 is sliced, otherwise players whose pending growth would
 * push them into the top 50 are dropped by the raw-count ranking.
 */
function sortEntries(entries) {
  return sortByDisplayedSubscribers(entries);
}

function firebaseUrl(key = '') {
  const suffix = key ? `/${encodeURIComponent(key)}` : '';
  return databaseUrl(`${FIREBASE_PATH}${suffix}`);
}

function counterUrl(key = '') {
  const suffix = key ? `/${encodeURIComponent(key)}` : '';
  return databaseUrl(`${COUNTER_PATH}${suffix}`);
}

async function readCounter() {
  const response = await fetch(counterUrl());
  if (!response.ok) {
    throw new Error(`Counter read failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    value: Number(data?.value) || 0,
    history: Array.isArray(data?.history)
      ? data.history
      : data?.history && typeof data.history === 'object'
        ? Object.values(data.history)
        : [],
  };
}

async function incrementCounter() {
  const response = await fetch(counterUrl('value'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ '.sv': { increment: 1 } }),
  });

  if (!response.ok) {
    throw new Error(`Counter increment failed with HTTP ${response.status}`);
  }

  const committedValue = Number(await response.json()) || 0;
  const point = { value: committedValue, timestamp: new Date().toISOString() };
  const historyResponse = await fetch(counterUrl('history'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(point),
  });

  if (!historyResponse.ok) {
    throw new Error(`Counter history write failed with HTTP ${historyResponse.status}`);
  }

  const current = await readCounter();
  return { value: committedValue, history: current.history };
}

async function readEntries() {
  const response = await fetch(firebaseUrl());
  if (!response.ok) {
    throw new Error(`Database read failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data) return [];
  return Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
}

async function writeEntry(entry, key) {
  const response = await fetch(firebaseUrl(key), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });

  if (!response.ok) {
    throw new Error(`Database write failed with HTTP ${response.status}`);
  }

  return entry;
}

async function patchEntry(entry, key) {
  const response = await fetch(firebaseUrl(key), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });

  if (!response.ok) {
    throw new Error(`Database write failed with HTTP ${response.status}`);
  }

  return entry;
}

async function addEntry(entry) {
  return writeEntry({ ...entry, id: entry.userId }, entry.userId);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) {
          resolve({});
          return;
        }

        if (req.body && typeof req.body === 'object') {
          resolve(req.body);
          return;
        }

        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, 'https://example.com');
  const isTop50 = url.pathname.endsWith('/top50') || url.pathname === '/api/leaderboard/top50';
  const pathParts = url.pathname.split('/').filter(Boolean);
  const pathUserId = pathParts[0] === 'api' && pathParts[1] === 'leaderboard' && pathParts[2] !== 'top50'
    ? pathParts[2]
    : null;

  const isCounter = url.pathname.endsWith('/counter') || url.pathname === '/api/leaderboard/counter';

  if (req.method === 'GET' && isCounter) {
    try {
      res.writeHead(200);
      res.end(JSON.stringify(await readCounter()));
    } catch (error) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: error.message || 'Counter unavailable' }));
    }
    return;
  }

  if (req.method === 'GET') {
    try {
      const data = sortEntries(await readEntries());
      const payload = isTop50 ? data.slice(0, TOP_LIMIT) : data;
      res.writeHead(200);
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: error.message || 'Database unavailable' }));
    }
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : await readBody(req);
      const userId = pathUserId || body.userId;
      const updating = req.method === 'PUT' && Boolean(pathUserId);

      if (req.method === 'POST' && pathUserId) {
        const counter = await incrementCounter();
        res.writeHead(200);
        res.end(JSON.stringify({ message: 'Media counter incremented', counter }));
        return;
      }

      if (req.method === 'PUT' && !pathUserId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'PUT updates require /api/leaderboard/:userId' }));
        return;
      }

      if (!userId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'userId is required' }));
        return;
      }

      if (typeof userId !== 'string' || (body.guildId != null && typeof body.guildId !== 'string')) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'userId and guildId must be JSON strings. Put Discord IDs in double quotes to prevent rounding.',
        }));
        return;
      }

      const name = body.name || body.displayName || body.username || 'Unknown';
      const image = body.image || body.imageUrl || body.avatarUrl || null;
      const subscribers = Number(body.subscribers ?? body.subscriberCount ?? body.subs ?? 0);
      const offlineDuration = Number(body.offlineduration ?? 0);

      if (!Number.isFinite(subscribers) || !Number.isFinite(offlineDuration) || offlineDuration < 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid subscribers or offlineduration value' }));
        return;
      }

      const entryData = {
        name,
        image,
        subscribers,
        growth: Number(body.growth ?? body.growthCount ?? body.growthValue ?? 0),
        video: Number(body.video ?? body.videoCount ?? 0),
        short: Number(body.short ?? body.shortCount ?? 0),
        offlineduration: offlineDuration,
        guildId: body.guildId || null,
        userId,
      };

      if (updating) {
        const updatedEntry = { ...entryData, id: userId, updatedAt: new Date().toISOString() };
        await patchEntry(updatedEntry, userId);
        res.writeHead(200);
        res.end(JSON.stringify({ message: 'Leaderboard entry updated', entry: updatedEntry }));
        return;
      }

      const entry = {
        id: userId,
        createdAt: new Date().toISOString(),
        ...entryData,
      };

      await addEntry(entry);
      res.writeHead(200);
      res.end(JSON.stringify({ message: 'Leaderboard entry added', entry }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: error.message || 'Bad request' }));
    }
    return;
  }

  res.writeHead(405);
  res.end(JSON.stringify({ error: 'Method not allowed' }));
};
