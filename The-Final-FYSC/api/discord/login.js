const crypto = require('crypto');
const { setStateCookie, setRedirectCookie } = require('../lib/discord-auth');

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

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const authRedirect = String(req.query?.authredirect || 'connect');

  if (!clientId || !redirectUri) {
    res.writeHead(500);
    res.end(JSON.stringify({
      error: 'Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI environment variables',
    }));
    return;
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });

  res.writeHead(302, {
    Location: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
    'Set-Cookie': [setStateCookie(state), setRedirectCookie(authRedirect)],
  });
  res.end();
};
