const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const {
  signAccessToken,
  verifyAccessToken,
  refreshTokenExpiresAt,
  refreshTokenTtlMs
} = require('../utils/jwt');

test('signAccessToken and verifyAccessToken round-trip', () => {
  const token = signAccessToken({ id: 'u1', username: 'demo', sid: 's1' });
  const payload = verifyAccessToken(token);
  assert.equal(payload.id, 'u1');
  assert.equal(payload.username, 'demo');
  assert.equal(payload.sid, 's1');
});

test('verifyAccessToken rejects wrong token type', () => {
  const badToken = jwt.sign(
    { id: 'u1', username: 'demo', typ: 'refresh' },
    process.env.JWT_SECRET,
    {
      expiresIn: '10m',
      issuer: 'chatroom-api',
      audience: 'chatroom-client',
      algorithm: 'HS256'
    }
  );

  assert.throws(() => verifyAccessToken(badToken));
});

test('refresh token ttl helper returns future date', () => {
  const now = Date.now();
  const expires = refreshTokenExpiresAt(now);
  assert.ok(expires instanceof Date);
  assert.ok(expires.getTime() > now);
  assert.ok(refreshTokenTtlMs() >= 60 * 1000);
});
