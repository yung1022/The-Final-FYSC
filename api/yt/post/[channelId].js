const { findUserByChannelId, applyOfflineGrowth, saveEntry, normalizeEntry, currentUnixTime } = require('../../lib/yt-growth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const url = new URL(req.url, 'https://example.com');
  const channelId = url.pathname.split('/').filter(Boolean).pop();

  if (!channelId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'channelId is required' }));
    return;
  }

  try {
    const user = await findUserByChannelId(channelId);
    if (!user) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'channelId not found for any Discord-linked user' }));
      return;
    }

    const nextEntry = normalizeEntry(user, user.userId);
    if (nextEntry.ytgrowth == null || !Number.isFinite(nextEntry.ytgrowth) || nextEntry.ytgrowth <= 0) {
      nextEntry.ytgrowth = 1000 + Math.floor(Math.random() * 4001);
    }
    if (nextEntry.ytofflineduration == null || !Number.isFinite(nextEntry.ytofflineduration) || nextEntry.ytofflineduration <= 0) {
      nextEntry.ytofflineduration = currentUnixTime();
    }
    if (nextEntry.tempsub == null || !Number.isFinite(nextEntry.tempsub) || nextEntry.tempsub < 0) {
      nextEntry.tempsub = 0;
    }

    const processed = applyOfflineGrowth(nextEntry);
    const saved = await saveEntry({
      ...user,
      ...processed,
      userId: user.userId,
      ytid: channelId,
      ytofflineduration: processed.ytofflineduration,
      ytgrowth: processed.ytgrowth,
      tempsub: processed.tempsub,
      updatedAt: new Date().toISOString(),
    });

    res.writeHead(200);
    res.end(JSON.stringify({
      channelId,
      userId: user.userId,
      ytgrowth: saved.ytgrowth,
      tempsub: saved.tempsub,
      ytofflineduration: saved.ytofflineduration,
      subGain: saved.tempsub,
    }));
  } catch (error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: error.message || 'Failed to process yt post' }));
  }
};
