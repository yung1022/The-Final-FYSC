const http = require('http');
const { URL } = require('url');
const { addEntry, getEntries, getTopEntries, resetDB } = require('./db');

const PORT = process.env.PORT || 3000;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => Number(b.subscribers ?? 0) - Number(a.subscribers ?? 0));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/api/leaderboard' && req.method === 'GET') {
    const data = sortEntries(getEntries());
    sendJson(res, 200, data);
    return;
  }

  if (pathname === '/api/leaderboard/top50' && req.method === 'GET') {
    const data = getTopEntries(50);
    sendJson(res, 200, data);
    return;
  }

  if (pathname === '/api/leaderboard' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const name = body.name || body.displayName || body.username || 'Unknown';
      const subscribers = Number(body.subscribers ?? body.subscriberCount ?? body.subs ?? 0);

      if (!Number.isFinite(subscribers)) {
        sendJson(res, 400, { error: 'Invalid subscribers value' });
        return;
      }

      const entry = addEntry({
        name,
        subscribers,
        guildId: body.guildId || null,
        userId: body.userId || null,
      });

      sendJson(res, 200, {
        message: 'Leaderboard entry added',
        entry,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Bad request' });
    }
    return;
  }

  if (pathname === '/api/leaderboard/reset' && req.method === 'POST') {
    const cleared = resetDB();
    sendJson(res, 200, { message: 'Leaderboard reset', data: cleared });
    return;
  }

  sendJson(res, 404, { error: 'Route not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Leaderboard API running on http://0.0.0.0:${PORT}`);
  console.log('Endpoints:');
  console.log(`- GET http://localhost:${PORT}/api/leaderboard`);
  console.log(`- GET http://localhost:${PORT}/api/leaderboard/top50`);
  console.log(`- POST http://localhost:${PORT}/api/leaderboard`);
});
