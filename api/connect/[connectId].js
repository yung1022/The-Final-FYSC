const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');

function requireFirebase() {
  if (!FIREBASE_URL) {
    throw new Error('FIREBASE_DB_URL is not configured in Vercel');
  }
}

function firebaseUrl(path = '') {
  requireFirebase();
  const suffix = path ? `/${path.replace(/^\//, '')}` : '';
  return `${FIREBASE_URL}${suffix}.json`;
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

function sanitizeValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function generateConnectId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(payload || `Request failed with HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function writeConnection(entry) {
  const connectionResponse = await fetchJson(firebaseUrl(`/youtube-connections/${encodeURIComponent(entry.connectId)}`), {
    method: 'PUT',
    body: JSON.stringify(entry),
  });

  if (entry.userId) {
    await fetchJson(firebaseUrl(`/youtube-user-links/${encodeURIComponent(entry.userId)}`), {
      method: 'PUT',
      body: JSON.stringify({
        userId: entry.userId,
        connectId: entry.connectId,
        youtubeChannelId: entry.youtubeChannelId,
        guildId: entry.guildId || null,
        linkedAt: entry.createdAt,
      }),
    });
  }

  if (entry.youtubeChannelId) {
    await fetchJson(firebaseUrl(`/youtube-channel-links/${encodeURIComponent(entry.youtubeChannelId)}`), {
      method: 'PUT',
      body: JSON.stringify({
        youtubeChannelId: entry.youtubeChannelId,
        connectId: entry.connectId,
        userId: entry.userId || null,
        guildId: entry.guildId || null,
        linkedAt: entry.createdAt,
      }),
    });
  }

  return connectionResponse;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, 'https://example.com');
  const pathParts = url.pathname.split('/').filter(Boolean);
  const connectId = pathParts[0] === 'api' && pathParts[1] === 'connect' ? (pathParts[2] || null) : null;
  const requestedChannel = url.searchParams.get('channel') || url.searchParams.get('youtubeChannelId') || url.searchParams.get('channelId');

  if (!connectId && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({
      message: 'YouTube connect API',
      endpoint: '/api/connect/:connectId?channel={youtubeChannelId}',
      example: '/api/connect/ABC123?channel=UC1234567890',
    }));
    return;
  }

  if (!connectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'connectId is required in the route /api/connect/:connectId' }));
    return;
  }

  if (req.method === 'GET') {
    try {
      const data = await fetchJson(firebaseUrl(`/youtube-connections/${encodeURIComponent(connectId)}`));
      if (!data) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'connectId not found' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: error.message || 'Connection lookup failed' }));
    }
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    try {
      if (req.method === 'DELETE') {
        await fetchJson(firebaseUrl(`/youtube-connections/${encodeURIComponent(connectId)}`), { method: 'DELETE' });
        res.writeHead(200);
        res.end(JSON.stringify({ message: 'Connection removed', connectId }));
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : await readBody(req);
      const channelId = sanitizeValue(body.channel || body.youtubeChannelId || body.channelId || requestedChannel);
      const userId = sanitizeValue(body.userId || body.discordUserId || body.user_id || body.memberId || body.discordId);
      const guildId = sanitizeValue(body.guildId || body.discordGuildId || body.guild_id || body.serverId || null);

      if (!channelId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'channel is required. Use ?channel=YOUTUBE_CHANNEL_ID or body.channel' }));
        return;
      }

      const entry = {
        connectId,
        userId: userId || null,
        guildId: guildId || null,
        youtubeChannelId: channelId,
        createdAt: new Date().toISOString(),
      };

      await writeConnection(entry);
      res.writeHead(200);
      res.end(JSON.stringify({
        message: 'YouTube channel connected',
        connectId,
        userId: entry.userId,
        guildId: entry.guildId,
        youtubeChannelId: entry.youtubeChannelId,
        apiUrl: `/api/connect/${connectId}?channel=${encodeURIComponent(channelId)}`,
        command: userId ? `!connect ${connectId}` : `!connect ${connectId}`,
      }));
      return;
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: error.message || 'Bad request' }));
    }
  }

  res.writeHead(405);
  res.end(JSON.stringify({ error: 'Method not allowed' }));
};

module.exports.generateConnectId = generateConnectId;
