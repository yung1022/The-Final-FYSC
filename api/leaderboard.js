const store = globalThis.__leaderboardStore || (globalThis.__leaderboardStore = []);

function sortEntries(entries) {
  return [...entries].sort((a, b) => Number(b.subscribers ?? 0) - Number(a.subscribers ?? 0));
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

  if (req.method === 'GET') {
    const data = sortEntries(store);
    const payload = isTop50 ? data.slice(0, 50) : data;
    res.writeHead(200);
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : await readBody(req);
      if (req.method === 'PUT' && !body.userId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'userId is required to update an entry' }));
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
        userId: body.userId || null,
      };

      if (req.method === 'PUT') {
        const index = store.findIndex((entry) => entry.userId === String(body.userId));
        if (index === -1) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Leaderboard entry not found' }));
          return;
        }

        store[index] = { ...store[index], ...entryData, updatedAt: new Date().toISOString() };
        res.writeHead(200);
        res.end(JSON.stringify({ message: 'Leaderboard entry updated', entry: store[index] }));
        return;
      }

      const entry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        createdAt: new Date().toISOString(),
        ...entryData,
      };

      store.push(entry);
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
