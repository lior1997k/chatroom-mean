const jwt = require('jsonwebtoken');

const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const JWT_ISSUER = 'chatroom-api';
const JWT_AUDIENCE = 'chatroom-client';
const ACCESS_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '20m';
const REFRESH_EXPIRES_IN_MS = Math.max(60 * 1000, Number(process.env.REFRESH_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000));

function ensureJwtSecret() {
  if (!JWT_SECRET) {
    throw new Error('Missing JWT_SECRET');
  }
}

function signAccessToken(payload) {
  ensureJwtSecret();
  return jwt.sign({ ...payload, typ: 'access' }, JWT_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256'
  });
}

function verifyAccessToken(token) {
  ensureJwtSecret();
  const payload = jwt.verify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: ['HS256']
  });
  if (payload?.typ && payload.typ !== 'access') {
    throw new Error('Invalid token type');
  }
  return payload;
}

function refreshTokenExpiresAt(fromMs = Date.now()) {
  return new Date(Number(fromMs) + REFRESH_EXPIRES_IN_MS);
}

function refreshTokenTtlMs() {
  return REFRESH_EXPIRES_IN_MS;
}

function signToken(payload) {
  return signAccessToken(payload);
}

function verifyToken(token) {
  return verifyAccessToken(token);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  refreshTokenExpiresAt,
  refreshTokenTtlMs,
  signToken,
  verifyToken
};
