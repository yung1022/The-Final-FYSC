const { requireDiscordSession, makeConnectId } = require('../lib/discord-auth');

const FIREBASE_URL = process.env.FIREBASE_DB_URL?.replace(/\/$/, '');

function firebaseUrl(path = '') {
  if (!FIREBASE_URL) {
    throw new Error('FIREBASE_DB_URL is not configured in Vercel');
  }

  const cleanPath = String(path || '').replace(/^\/+/, '');
  return `${FIREBASE_URL}/${cleanPath}.json`;
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const session = requireDiscordSession(req);
    const connectId = makeConnectId();
    const firebasePath = `youtube-connections/${encodeURIComponent(connectId)}`;

    const record = {
      connectId,
      discordUserId: session.discordUserId,
      discordUsername: session.discordUsername || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await writeFirebaseRecord(firebasePath, record);

    res.writeHead(200);
    res.end(JSON.stringify({
      message: 'Connect code generated',
      connectId,
      discordUserId: session.discordUserId,
      command: `!connect ${connectId}`,
      apiUrl: `/api/connect/${connectId}?channel=YOUTUBE_CHANNEL_ID`,
    }));
  } catch (error) {
    res.writeHead(error.statusCode || 400);
    res.end(JSON.stringify({ error: error.message || 'Failed to generate connect code' }));
  }
};
