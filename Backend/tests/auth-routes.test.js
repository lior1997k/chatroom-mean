const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AuthAbuseEvent = require('../models/AuthAbuseEvent');
const userRoutes = require('../routes/user');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createThenable(value, leanValue = value) {
  const promise = Promise.resolve(value);
  return {
    lean: () => Promise.resolve(leanValue ? clone(leanValue) : null),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise)
  };
}

function patchModels(t) {
  const users = new Map();
  const sessions = new Map();

  const original = {
    user: {
      create: User.create,
      findOne: User.findOne,
      findById: User.findById,
      updateOne: User.updateOne
    },
    session: {
      create: AuthSession.create,
      findOne: AuthSession.findOne,
      updateOne: AuthSession.updateOne,
      updateMany: AuthSession.updateMany,
      find: AuthSession.find
    },
    abuseCreate: AuthAbuseEvent.create
  };

  function queryMatches(doc, query = {}) {
    return Object.entries(query).every(([key, expected]) => {
      const actual = doc[key];
      if (expected && typeof expected === 'object' && '$gt' in expected) {
        return Number(new Date(actual || 0).getTime()) > Number(new Date(expected.$gt || 0).getTime());
      }
      if (key === '_id') {
        return String(actual) === String(expected);
      }
      return String(actual ?? '') === String(expected ?? '');
    });
  }

  function userDoc(data) {
    const doc = {
      _id: data._id || new mongoose.Types.ObjectId(),
      username: data.username,
      email: data.email || null,
      password: data.password ?? null,
      avatarUrl: data.avatarUrl || '',
      role: data.role || 'user',
      googleSub: data.googleSub || null,
      appleSub: data.appleSub || null,
      emailVerified: !!data.emailVerified,
      emailVerificationTokenHash: data.emailVerificationTokenHash || null,
      emailVerificationExpiresAt: data.emailVerificationExpiresAt || null,
      emailVerificationRequestedAt: data.emailVerificationRequestedAt || null,
      passwordResetTokenHash: data.passwordResetTokenHash || null,
      passwordResetExpiresAt: data.passwordResetExpiresAt || null,
      passwordResetRequestedAt: data.passwordResetRequestedAt || null,
      loginFailures: Number(data.loginFailures || 0),
      lockUntil: data.lockUntil || null,
      lastLoginAt: data.lastLoginAt || null,
      passwordChangedAt: data.passwordChangedAt || null,
      async save() {
        users.set(String(this._id), this);
        return this;
      }
    };
    users.set(String(doc._id), doc);
    return doc;
  }

  function sessionDoc(data) {
    const doc = {
      _id: data._id || new mongoose.Types.ObjectId(),
      userId: data.userId,
      refreshTokenHash: data.refreshTokenHash,
      tokenFamily: data.tokenFamily,
      replacedBySessionId: data.replacedBySessionId || null,
      userAgent: data.userAgent || '',
      ip: data.ip || '',
      expiresAt: data.expiresAt,
      lastUsedAt: data.lastUsedAt || null,
      revokedAt: data.revokedAt || null,
      createdAt: data.createdAt || new Date(),
      async save() {
        sessions.set(String(this._id), this);
        return this;
      }
    };
    sessions.set(String(doc._id), doc);
    return doc;
  }

  User.create = async (data) => userDoc(data);
  User.findOne = (query) => {
    const found = Array.from(users.values()).find((doc) => queryMatches(doc, query));
    return createThenable(found || null, found || null);
  };
  User.findById = async (id) => {
    for (const doc of users.values()) {
      if (String(doc._id) === String(id)) return doc;
    }
    return null;
  };
  User.updateOne = async (query, update = {}) => {
    const found = Array.from(users.values()).find((doc) => queryMatches(doc, query));
    if (!found) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    if (update.$set && typeof update.$set === 'object') {
      Object.assign(found, update.$set);
    }
    users.set(String(found._id), found);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  };

  AuthSession.create = async (data) => sessionDoc(data);
  AuthSession.findOne = async (query) => {
    const found = Array.from(sessions.values()).find((doc) => queryMatches(doc, query));
    return found || null;
  };
  AuthSession.updateOne = async (query, update = {}) => {
    const found = Array.from(sessions.values()).find((doc) => queryMatches(doc, query));
    if (!found) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    if (update.$set && typeof update.$set === 'object') {
      Object.assign(found, update.$set);
    }
    sessions.set(String(found._id), found);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  };
  AuthSession.updateMany = async (query, update = {}) => {
    const matches = Array.from(sessions.values()).filter((doc) => queryMatches(doc, query));
    matches.forEach((doc) => {
      if (update.$set && typeof update.$set === 'object') {
        Object.assign(doc, update.$set);
      }
      sessions.set(String(doc._id), doc);
    });
    return { acknowledged: true, matchedCount: matches.length, modifiedCount: matches.length };
  };
  AuthSession.find = () => ({
    sort: () => ({
      limit: () => ({
        lean: async () => []
      })
    })
  });

  AuthAbuseEvent.create = async () => ({ ok: true });

  t.after(() => {
    User.create = original.user.create;
    User.findOne = original.user.findOne;
    User.findById = original.user.findById;
    User.updateOne = original.user.updateOne;
    AuthSession.create = original.session.create;
    AuthSession.findOne = original.session.findOne;
    AuthSession.updateOne = original.session.updateOne;
    AuthSession.updateMany = original.session.updateMany;
    AuthSession.find = original.session.find;
    AuthAbuseEvent.create = original.abuseCreate;
  });

  return { users, sessions };
}

async function createServer(t) {
  const app = express();
  app.use(express.json());
  app.use('/api/user', userRoutes);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  t.after(() => {
    server.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl };
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
}

test('auth routes support verification, reset, and refresh lifecycle', async (t) => {
  const { users } = patchModels(t);

  const { baseUrl } = await createServer(t);

  const register = await postJson(baseUrl, '/api/user/register', {
    username: 'demo_user',
    email: 'demo@example.com',
    password: 'StrongPass1!'
  });
  assert.equal(register.status, 201);

  const loginBeforeVerify = await postJson(baseUrl, '/api/user/login', {
    identifier: 'demo@example.com',
    password: 'StrongPass1!'
  });
  assert.equal(loginBeforeVerify.status, 403);
  assert.equal(loginBeforeVerify.body?.error?.code, 'EMAIL_NOT_VERIFIED');

  const createdUser = Array.from(users.values()).find((doc) => doc.email === 'demo@example.com');
  const verifyRawToken = 'verify-token-123';
  createdUser.emailVerificationTokenHash = crypto.createHash('sha256').update(verifyRawToken).digest('hex');
  createdUser.emailVerificationExpiresAt = new Date(Date.now() + 60_000);
  await createdUser.save();

  const verify = await postJson(baseUrl, '/api/user/verify-email/confirm', {
    email: 'demo@example.com',
    token: verifyRawToken
  });
  assert.equal(verify.status, 200);

  const login = await postJson(baseUrl, '/api/user/login', {
    identifier: 'demo@example.com',
    password: 'StrongPass1!'
  });
  assert.equal(login.status, 200);
  assert.ok(login.body?.token);
  assert.ok(login.body?.refreshToken);

  const forgot = await postJson(baseUrl, '/api/user/password/forgot', {
    email: 'demo@example.com'
  });
  assert.equal(forgot.status, 200);

  const resetRawToken = 'reset-token-123';
  createdUser.passwordResetTokenHash = crypto.createHash('sha256').update(resetRawToken).digest('hex');
  createdUser.passwordResetExpiresAt = new Date(Date.now() + 60_000);
  await createdUser.save();

  const reset = await postJson(baseUrl, '/api/user/password/reset', {
    email: 'demo@example.com',
    token: resetRawToken,
    password: 'EvenStronger1!'
  });
  assert.equal(reset.status, 200);

  const oldPasswordLogin = await postJson(baseUrl, '/api/user/login', {
    identifier: 'demo@example.com',
    password: 'StrongPass1!'
  });
  assert.equal(oldPasswordLogin.status, 401);

  const newPasswordLogin = await postJson(baseUrl, '/api/user/login', {
    identifier: 'demo@example.com',
    password: 'EvenStronger1!'
  });
  assert.equal(newPasswordLogin.status, 200);
  assert.ok(newPasswordLogin.body?.refreshToken);

  const refresh = await postJson(baseUrl, '/api/user/refresh-token', {
    refreshToken: newPasswordLogin.body.refreshToken
  });
  assert.equal(refresh.status, 200);
  assert.ok(refresh.body?.refreshToken);
  assert.notEqual(refresh.body?.refreshToken, newPasswordLogin.body.refreshToken);

  const staleRefresh = await postJson(baseUrl, '/api/user/refresh-token', {
    refreshToken: newPasswordLogin.body.refreshToken
  });
  assert.equal(staleRefresh.status, 401);
  assert.equal(staleRefresh.body?.error?.code, 'REFRESH_TOKEN_INVALID');
});
