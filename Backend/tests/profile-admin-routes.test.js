const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

const { signAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const PublicMessage = require('../models/PublicMessage');
const PrivateMessage = require('../models/PrivateMessage');
const AuthSession = require('../models/AuthSession');
const AttachmentReport = require('../models/AttachmentReport');
const AuthAbuseEvent = require('../models/AuthAbuseEvent');
const ModerationAction = require('../models/ModerationAction');
const meRoutes = require('../routes/me');
const adminRoutes = require('../routes/admin-auth');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function queryResult(doc) {
  const promise = Promise.resolve(doc || null);
  return {
    select() {
      return {
        lean: async () => (doc ? clone(doc) : null)
      };
    },
    lean: async () => (doc ? clone(doc) : null),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise)
  };
}

function patchModels(t) {
  const userStore = new Map();
  const messageStore = new Map();

  const adminUser = {
    _id: new mongoose.Types.ObjectId(),
    username: 'admin',
    role: 'admin',
    email: 'admin@chatroom.local',
    emailVerified: true,
    avatarUrl: '',
    lastSeenVisibility: 'everyone',
    async save() { userStore.set(String(this._id), this); return this; }
  };

  const moderatorUser = {
    _id: new mongoose.Types.ObjectId(),
    username: 'mod',
    role: 'moderator',
    email: 'mod@chatroom.local',
    emailVerified: true,
    avatarUrl: '',
    lastSeenVisibility: 'everyone',
    async save() { userStore.set(String(this._id), this); return this; }
  };

  const regularUser = {
    _id: new mongoose.Types.ObjectId(),
    username: 'member',
    role: 'user',
    email: 'member@example.com',
    emailVerified: true,
    avatarUrl: '',
    lastSeenVisibility: 'everyone',
    async save() { userStore.set(String(this._id), this); return this; }
  };

  [adminUser, moderatorUser, regularUser].forEach((u) => userStore.set(String(u._id), u));

  const publicMessage = {
    _id: new mongoose.Types.ObjectId(),
    from: 'admin',
    text: 'hello',
    attachment: null,
    attachments: [],
    deletedAt: null,
    reactions: [],
    async save() { messageStore.set(String(this._id), this); return this; }
  };
  messageStore.set(String(publicMessage._id), publicMessage);

  const original = {
    userFindById: User.findById,
    userFindOne: User.findOne,
    publicFindById: PublicMessage.findById,
    privateFindById: PrivateMessage.findById,
    sessionUpdateMany: AuthSession.updateMany,
    reportFind: AttachmentReport.find,
    reportFindById: AttachmentReport.findById,
    reportCountDocuments: AttachmentReport.countDocuments,
    abuseFind: AuthAbuseEvent.find,
    abuseCountDocuments: AuthAbuseEvent.countDocuments,
    moderationCreate: ModerationAction.create,
    moderationFind: ModerationAction.find,
    moderationCount: ModerationAction.countDocuments
  };

  User.findById = (id) => {
    const found = Array.from(userStore.values()).find((u) => String(u._id) === String(id));
    return queryResult(found || null);
  };

  User.findOne = (query = {}) => {
    const byUsername = String(query.username || '').toLowerCase();
    const byEmail = String(query.email || '').toLowerCase();
    const found = Array.from(userStore.values()).find((u) => {
      if (byUsername && String(u.username).toLowerCase() === byUsername) return true;
      if (byEmail && String(u.email).toLowerCase() === byEmail) return true;
      return false;
    });
    return queryResult(found || null);
  };

  PublicMessage.findById = async (id) => {
    const found = Array.from(messageStore.values()).find((m) => String(m._id) === String(id));
    return found || null;
  };

  PrivateMessage.findById = async () => null;
  AuthSession.updateMany = async () => ({ matchedCount: 0, modifiedCount: 0 });
  AttachmentReport.find = () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) });
  AttachmentReport.findById = async () => null;
  AttachmentReport.countDocuments = async () => 0;
  AuthAbuseEvent.find = () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) });
  AuthAbuseEvent.countDocuments = async () => 0;
  ModerationAction.create = async () => ({ ok: true });
  ModerationAction.find = () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) });
  ModerationAction.countDocuments = async () => 0;

  t.after(() => {
    User.findById = original.userFindById;
    User.findOne = original.userFindOne;
    PublicMessage.findById = original.publicFindById;
    PrivateMessage.findById = original.privateFindById;
    AuthSession.updateMany = original.sessionUpdateMany;
    AttachmentReport.find = original.reportFind;
    AttachmentReport.findById = original.reportFindById;
    AttachmentReport.countDocuments = original.reportCountDocuments;
    AuthAbuseEvent.find = original.abuseFind;
    AuthAbuseEvent.countDocuments = original.abuseCountDocuments;
    ModerationAction.create = original.moderationCreate;
    ModerationAction.find = original.moderationFind;
    ModerationAction.countDocuments = original.moderationCount;
  });

  return { adminUser, moderatorUser, regularUser, publicMessage, userStore };
}

async function createServer(t) {
  const app = express();
  app.use(express.json());
  app.use('/api/me', meRoutes);
  app.use('/api/admin/auth', adminRoutes);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  t.after(() => {
    server.close();
  });

  return `http://127.0.0.1:${server.address().port}`;
}

async function send(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
}

test('profile route blocks username change after creation', async (t) => {
  const { regularUser } = patchModels(t);
  const baseUrl = await createServer(t);
  const token = signAccessToken({ id: regularUser._id.toString(), username: regularUser.username });

  const result = await send(baseUrl, 'PATCH', '/api/me/profile', token, {
    username: 'new_name',
    displayName: 'Member Name'
  });

  assert.equal(result.status, 403);
  assert.equal(result.body?.error?.code, 'USERNAME_IMMUTABLE');
});

test('only admin can change roles', async (t) => {
  const { adminUser, moderatorUser, regularUser, userStore } = patchModels(t);
  const baseUrl = await createServer(t);
  const moderatorToken = signAccessToken({ id: moderatorUser._id.toString(), username: moderatorUser.username });
  const adminToken = signAccessToken({ id: adminUser._id.toString(), username: adminUser.username });

  const denied = await send(baseUrl, 'PATCH', `/api/admin/auth/users/${regularUser._id.toString()}/role`, moderatorToken, {
    role: 'support'
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body?.error?.code, 'ADMIN_ROLE_FORBIDDEN');

  const allowed = await send(baseUrl, 'PATCH', `/api/admin/auth/users/${regularUser._id.toString()}/role`, adminToken, {
    role: 'support'
  });
  assert.equal(allowed.status, 200);
  assert.equal(userStore.get(String(regularUser._id)).role, 'support');
});

test('moderator cannot remove message from admin author', async (t) => {
  const { moderatorUser, publicMessage } = patchModels(t);
  const baseUrl = await createServer(t);
  const moderatorToken = signAccessToken({ id: moderatorUser._id.toString(), username: moderatorUser.username });

  const result = await send(
    baseUrl,
    'POST',
    `/api/admin/auth/messages/public/${publicMessage._id.toString()}/remove`,
    moderatorToken,
    {}
  );

  assert.equal(result.status, 403);
  assert.equal(result.body?.error?.code, 'ADMIN_TARGET_FORBIDDEN');
});
