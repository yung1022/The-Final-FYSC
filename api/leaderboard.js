const DEMO_ENTRIES = [
  { id: 1, name: 'Alice', subscribers: 25000, guildId: 'demo', userId: 'demo1' },
  { id: 2, name: 'Bob', subscribers: 22000, guildId: 'demo', userId: 'demo2' },
  { id: 3, name: 'Charlie', subscribers: 18000, guildId: 'demo', userId: 'demo3' },
  { id: 4, name: 'Diana', subscribers: 16000, guildId: 'demo', userId: 'demo4' },
  { id: 5, name: 'Ethan', subscribers: 12000, guildId: 'demo', userId: 'demo5' },
];

const store = globalThis.__leaderboardStore || (globalThis.__leaderboardStore = [...DEMO_ENTRIES]);

function sortEntries(entries) {
  return [...entries].sort((a, b) => Number(b.subscribers ?? 0) - Number(a.subscribers ?? 0));
}

function ensureSeedData() {
  if (store.length === 0) {
    store.push(...DEMO_ENTRIES.map((entry, index) => ({
      ...entry,
      id: Date.now() + index,
      createdAt: new Date().toISOString(),
    })));
  }
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
    ensureSeedData();
    const data = sortEntries(store);
    const payload = isTop50 ? data.slice(0, 50) : data;
    res.writeHead(200);
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : await readBody(req);
      const name = body.name || body.displayName || body.username || 'Unknown';
      const subscribers = Number(body.subscribers ?? body.subscriberCount ?? body.subs ?? 0);

      if (!Number.isFinite(subscribers)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid subscribers value' }));
        return;
      }

      const entry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        createdAt: new Date().toISOString(),
        name,
        subscribers,
        guildId: body.guildId || null,
        userId: body.userId || null,
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
