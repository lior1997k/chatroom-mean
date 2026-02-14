const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { __test } = require('../routes/user');

test('normalize helpers trim and lowercase values', () => {
  assert.equal(__test.normalizeUsername('  Demo_User  '), 'demo_user');
  assert.equal(__test.normalizeEmail('  Person@Example.COM  '), 'person@example.com');
  assert.equal(__test.normalizeIdentifier('  USER_1  '), 'user_1');
});

test('password policy catches weak passwords', () => {
  const issues = __test.passwordPolicyIssues('abc');
  assert.ok(issues.includes('at least 8 characters'));
  assert.ok(issues.includes('an uppercase letter'));
  assert.ok(issues.includes('a number'));
  assert.ok(issues.includes('a symbol'));
  assert.deepEqual(__test.passwordPolicyIssues('StrongPass1!'), []);
});

test('suggested username uses email prefix and sanitizes', () => {
  const username = __test.suggestedUsernameFromProfile({ email: 'Jane.Doe+hello@example.com' });
  assert.equal(username, 'jane_doe_hello');
});

test('client nonce validation enforces expected format', () => {
  assert.equal(__test.isValidClientNonce('short_nonce'), false);
  assert.equal(__test.isValidClientNonce('A'.repeat(20)), true);
  assert.equal(__test.isValidClientNonce('A'.repeat(257)), false);
  assert.equal(__test.isValidClientNonce('bad space nonce________________'), false);
});

test('nonce matching accepts plain and sha256 nonce', () => {
  const nonce = 'SecureNonce_1234567890';
  const hashed = crypto.createHash('sha256').update(nonce).digest('hex');

  assert.equal(__test.nonceMatches(nonce, nonce), true);
  assert.equal(__test.nonceMatches(nonce, hashed), true);
  assert.equal(__test.nonceMatches(nonce, 'different_nonce_value'), false);
});
