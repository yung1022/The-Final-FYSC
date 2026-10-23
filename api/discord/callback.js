const { clearCookie, getStateFromRequest, setSessionCookie } = require('../lib/discord-auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const url = new URL(req.url, 'https://example.com');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const savedState = getStateFromRequest(req);

  if (!code || !state || !savedState || state !== savedState) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Invalid OAuth callback state' }));
    return;
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.writeHead(500);
    res.end(JSON.stringify({
      error: 'Missing DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, or DISCORD_REDIRECT_URI environment variables',
    }));
    return;
  }

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange Discord code');
    }

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();
    if (!userResponse.ok || !userData.id) {
      throw new Error(userData.message || 'Failed to fetch Discord user');
    }

    const session = {
      discordUserId: userData.id,
      discordUsername: userData.username,
      avatar: userData.avatar || null,
      connectedAt: new Date().toISOString(),
    };

    const cookies = [
      clearCookie('discord_oauth_state'),
      setSessionCookie(session),
    ];

    res.writeHead(302, {
      Location: '/connect',
      'Set-Cookie': cookies,
    });
    res.end();
  } catch (error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: error.message || 'Discord login failed' }));
  }
};
