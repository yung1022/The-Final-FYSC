const DEMO_ENTRIES = [
  { id: 1, name: 'Alice', subscribers: 25000 },
  { id: 2, name: 'Ben', subscribers: 22000 },
  { id: 3, name: 'Chris', subscribers: 21000 },
  { id: 4, name: 'Diana', subscribers: 19800 },
  { id: 5, name: 'Ethan', subscribers: 18500 },
  { id: 6, name: 'Fiona', subscribers: 17000 },
  { id: 7, name: 'George', subscribers: 16500 },
  { id: 8, name: 'Hannah', subscribers: 15200 },
  { id: 9, name: 'Ian', subscribers: 14800 },
  { id: 10, name: 'Julia', subscribers: 14300 },
];

const store = globalThis.__leaderboardStore || (globalThis.__leaderboardStore = DEMO_ENTRIES);

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
