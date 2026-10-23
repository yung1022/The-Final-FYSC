const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');

function firebaseUrl(path = '') {
  if (!FIREBASE_URL) {
    throw new Error('FIREBASE_DB_URL is not configured in Vercel');
  }

  const cleanPath = String(path || '').replace(/^\/+/, '');
  return `${FIREBASE_URL}/${cleanPath}.json`;
}

function sanitizeString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

async function readFirebaseRecord(path) {
  try {
    const response = await fetch(firebaseUrl(path));
    if (!response.ok) return {};
    const text = await response.text();
    if (!text.trim()) return {};
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : {};
  } catch (error) {
    return {};
  }
}

async function writeFirebaseRecord(path, value) {
  const response = await fetch(firebaseUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Firebase write failed with HTTP ${response.status}`);
  }

  return value;
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
  const connectId = pathParts.length >= 2 && pathParts[0] === 'api' && pathParts[1] === 'connect'
    ? sanitizeString(pathParts[2])
    : null;

  if (!connectId) {
    res.writeHead(400);
    res.end(JSON.stringify({
      error: 'connectId is required. Example: /api/connect/ABC123?channel=UC1234567890',
    }));
    return;
  }

  const firebasePath = `youtube-connections/${encodeURIComponent(connectId)}`;

  if (req.method === 'GET') {
    try {
      const record = await readFirebaseRecord(firebasePath);
      if (!record || Object.keys(record).length === 0) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'connectId not found' }));
        return;
      }

      res.writeHead(200);
      res.end(JSON.stringify(record));
      return;
    } catch (error) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: error.message || 'Connection lookup failed' }));
      return;
    }
  }

  if (req.method === 'DELETE') {
    try {
      const existing = await readFirebaseRecord(firebasePath);
      const next = { ...existing, connectId, updatedAt: new Date().toISOString() };
      delete next.ytid;
      await writeFirebaseRecord(firebasePath, next);
      res.writeHead(200);
      res.end(JSON.stringify({ message: 'Connection removed', connectId }));
      return;
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: error.message || 'Delete failed' }));
      return;
    }
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const channel = sanitizeString(
        body.channel ??
        body.youtubeChannelId ??
        body.channelId ??
        url.searchParams.get('channel') ??
        url.searchParams.get('youtubeChannelId') ??
        url.searchParams.get('channelId')
      );

      if (!channel) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'channel is required. Use ?channel=YOUTUBE_CHANNEL_ID or body.channel' }));
        return;
      }

      const existing = await readFirebaseRecord(firebasePath);
      const updated = {
        ...existing,
        connectId,
        ytid: channel,
        updatedAt: new Date().toISOString(),
      };

      await writeFirebaseRecord(firebasePath, updated);

      res.writeHead(200);
      res.end(JSON.stringify({
        message: 'YouTube channel connected',
        connectId,
        discordUserId: updated.discordUserId || null,
        ytid: updated.ytid,
        command: `!connect ${connectId}`,
      }));
      return;
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: error.message || 'Bad request' }));
      return;
    }
  }

  res.writeHead(405);
  res.end(JSON.stringify({ error: 'Method not allowed' }));
};
