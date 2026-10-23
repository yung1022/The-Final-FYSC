const crypto = require('crypto');

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getSessionSecret() {
  return process.env.DISCORD_SESSION_SECRET || 'dev-discord-session-secret';
}

function signValue(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('hex');
}

function serializeSession(session) {
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = signValue(payload);
  return `${payload}.${signature}`;
}

function deserializeSession(rawValue) {
  if (!rawValue) return null;
  const [payload, signature] = String(rawValue).split('.');
  if (!payload || !signature) return null;
  if (signature !== signValue(payload)) return null;

  try {
    return JSON.parse(base64UrlDecode(payload));
  } catch (error) {
    return null;
  }
}

function parseCookies(rawCookieHeader = '') {
  const cookies = {};
  const pairs = String(rawCookieHeader).split(';');

  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function setCookie(name, value, options = {}) {
  const secure = options.secure ?? true;
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (secure) parts.push('Secure');
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);

  return parts.join('; ');
}

function clearCookie(name) {
  return setCookie(name, '', { maxAge: 0, secure: true });
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const raw = cookies.discord_session;
  return deserializeSession(raw);
}

function requireDiscordSession(req) {
  const session = getSessionFromRequest(req);
  if (!session || !session.discordUserId) {
    const error = new Error('Discord login required');
    error.statusCode = 401;
    throw error;
  }

  return session;
}

function setSessionCookie(session) {
  const value = serializeSession(session);
  return setCookie('discord_session', value, { secure: true });
}

function setStateCookie(value) {
  return setCookie('discord_oauth_state', value, { secure: true });
}

function getStateFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.discord_oauth_state || null;
}

function makeConnectId() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

module.exports = {
  parseCookies,
  setCookie,
  clearCookie,
  getSessionFromRequest,
  requireDiscordSession,
  setSessionCookie,
  setStateCookie,
  getStateFromRequest,
  makeConnectId,
  serializeSession,
  deserializeSession,
};
