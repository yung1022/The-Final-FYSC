const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');
const FIREBASE_PATH = 'leaderboard';

function sortEntries(entries) {
  return [...entries].sort((a, b) => Number(b.subscribers ?? 0) - Number(a.subscribers ?? 0));
}

function firebaseUrl(key = '') {
  if (!FIREBASE_URL) {
    throw new Error('FIREBASE_DB_URL is not configured in Vercel');
  }

  const suffix = key ? `/${encodeURIComponent(key)}` : '';
  return `${FIREBASE_URL}/${FIREBASE_PATH}${suffix}.json`;
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

  if (req.method === 'GET') {
    try {
      const data = sortEntries(await readEntries());
      const payload = isTop50 ? data.slice(0, 50) : data;
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
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Use POST /api/leaderboard to add or PUT /api/leaderboard/:userId to update' }));
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

      const name = body.name || body.displayName || body.username || 'Unknown';
      const subscribers = Number(body.subscribers ?? body.subscriberCount ?? body.subs ?? 0);

      if (!Number.isFinite(subscribers)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid subscribers value' }));
        return;
      }

      const entryData = {
        name,
        subscribers,
        growth: Number(body.growth ?? body.growthCount ?? body.growthValue ?? 0),
        video: Number(body.video ?? body.videoCount ?? 0),
        short: Number(body.short ?? body.shortCount ?? 0),
        guildId: body.guildId || null,
        userId: userId || null,
      };

      if (updating) {
        const entries = await readEntries();
        const index = entries.findIndex((entry) => String(entry.userId) === String(userId));
        if (index === -1) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Leaderboard entry not found; add it with POST /api/leaderboard first' }));
          return;
        }

        const existing = entries[index];
        const updatedEntry = { ...existing, ...entryData, id: userId, updatedAt: new Date().toISOString() };
        await writeEntry(updatedEntry, userId);
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
