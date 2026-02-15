const express = require('express');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AuthAbuseEvent = require('../models/AuthAbuseEvent');
const AttachmentReport = require('../models/AttachmentReport');
const PublicMessage = require('../models/PublicMessage');
const PrivateMessage = require('../models/PrivateMessage');
const ModerationAction = require('../models/ModerationAction');
const { hasCapability, canActOnTargetRole } = require('../utils/permissions');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/admin');

const router = express.Router();
const ALLOWED_ROLE_VALUES = new Set(['user', 'moderator', 'support', 'admin']);

function canManageRoles(role) {
  return hasCapability(role, 'manage_roles');
}

function deny(res, code, message) {
  return res.status(403).json({
    error: {
      code,
      message
    }
  });
}

function canAdminUserActOnTarget(req, targetUser) {
  const actorId = String(req.adminUser?._id || '');
  const targetId = String(targetUser?._id || '');
  if (!targetId) return false;
  if (actorId && actorId === targetId) return false;
  return canActOnTargetRole(req.adminUser?.role, targetUser?.role);
}

function parsePaging(req, defaults = {}) {
  const limitDefault = Number(defaults.limit || 30);
  const limitMax = Number(defaults.max || 100);
  const page = Math.max(1, Number(req.query?.page || 1));
  const limit = Math.max(1, Math.min(limitMax, Number(req.query?.limit || limitDefault)));
  return {
    page,
    limit,
    skip: (page - 1) * limit
  };
}

async function logModerationAction(req, action, targetType, targetId, details = null) {
  try {
    await ModerationAction.create({
      actorId: req.adminUser?._id,
      actorUsername: String(req.user?.username || req.adminUser?.username || ''),
      actorRole: String(req.adminUser?.role || ''),
      action,
      targetType,
      targetId: String(targetId || ''),
      details
    });
  } catch {
    // no-op
  }
}

router.use(auth, requireAdmin);

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim().toLowerCase();
    const roleFilter = String(req.query?.role || '').trim().toLowerCase();
    const verifiedFilter = String(req.query?.verified || '').trim().toLowerCase();
    const sortBy = String(req.query?.sortBy || 'createdAt').trim();
    const sortDir = String(req.query?.sortDir || 'desc').trim().toLowerCase() === 'asc' ? 1 : -1;
    const paging = parsePaging(req, { limit: 30, max: 100 });
    const filter = q
      ? {
        $or: [
          { username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        ]
      }
      : {};

    if (['user', 'moderator', 'support', 'admin'].includes(roleFilter)) {
      filter.role = roleFilter;
    }
    if (verifiedFilter === 'true') filter.emailVerified = true;
    if (verifiedFilter === 'false') filter.emailVerified = false;

    const allowedSort = new Set(['createdAt', 'lastLoginAt', 'username']);
    const sortField = allowedSort.has(sortBy) ? sortBy : 'createdAt';

    const [users, total] = await Promise.all([
      User.find(filter)
      .select('_id username email emailVerified role avatarUrl loginFailures lockUntil lastLoginAt createdAt')
      .sort({ [sortField]: sortDir })
      .skip(paging.skip)
      .limit(paging.limit)
      .lean(),
      User.countDocuments(filter)
    ]);

    return res.json({
      items: users,
      paging: {
        page: paging.page,
        limit: paging.limit,
        total,
        pages: Math.max(1, Math.ceil(total / paging.limit))
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'ADMIN_USERS_FETCH_FAILED',
        message: 'Could not load auth users.'
      }
    });
  }
});

router.post('/users/:id/verify-email', async (req, res) => {
  try {
    if (!hasCapability(req.adminUser?.role, 'manage_user_security')) {
      return deny(res, 'ADMIN_PERMISSION_DENIED', 'You do not have permission to verify user email.');
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    if (!canAdminUserActOnTarget(req, user)) {
      return deny(res, 'ADMIN_TARGET_FORBIDDEN', 'You cannot verify this account.');
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    user.emailVerificationRequestedAt = null;
    await user.save();
    await logModerationAction(req, 'verify-user-email', 'user', user._id);

    return res.json({ message: 'User email marked as verified.' });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_VERIFY_FAILED',
        message: 'Could not update email verification.'
      }
    });
  }
});

router.post('/users/:id/unlock', async (req, res) => {
  try {
    if (!hasCapability(req.adminUser?.role, 'manage_user_security')) {
      return deny(res, 'ADMIN_PERMISSION_DENIED', 'You do not have permission to unlock users.');
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    if (!canAdminUserActOnTarget(req, user)) {
      return deny(res, 'ADMIN_TARGET_FORBIDDEN', 'You cannot unlock this account.');
    }

    user.loginFailures = 0;
    user.lockUntil = null;
    await user.save();
    await logModerationAction(req, 'unlock-user', 'user', user._id);

    return res.json({ message: 'User account unlocked.' });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_UNLOCK_FAILED',
        message: 'Could not unlock user account.'
      }
    });
  }
});

router.post('/users/:id/revoke-sessions', async (req, res) => {
  try {
    if (!hasCapability(req.adminUser?.role, 'manage_user_security')) {
      return deny(res, 'ADMIN_PERMISSION_DENIED', 'You do not have permission to revoke sessions.');
    }

    const user = await User.findById(req.params.id).lean();
    if (!user) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    if (!canAdminUserActOnTarget(req, user)) {
      return deny(res, 'ADMIN_TARGET_FORBIDDEN', 'You cannot revoke sessions for this account.');
    }

    await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await logModerationAction(req, 'revoke-user-sessions', 'user', user._id);
    return res.json({ message: 'User sessions revoked.' });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_REVOKE_SESSIONS_FAILED',
        message: 'Could not revoke user sessions.'
      }
    });
  }
});

router.get('/abuse-events', async (req, res) => {
  try {
    const paging = parsePaging(req, { limit: 80, max: 200 });
    const [events, total] = await Promise.all([
      AuthAbuseEvent.find({})
      .sort({ createdAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .lean(),
      AuthAbuseEvent.countDocuments({})
    ]);
    return res.json({
      items: events,
      paging: {
        page: paging.page,
        limit: paging.limit,
        total,
        pages: Math.max(1, Math.ceil(total / paging.limit))
      }
    });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_ABUSE_EVENTS_FAILED',
        message: 'Could not load abuse events.'
      }
    });
  }
});

router.patch('/users/:id/role', async (req, res) => {
  try {
    if (!canManageRoles(req.adminUser?.role)) {
      return res.status(403).json({
        error: {
          code: 'ADMIN_ROLE_FORBIDDEN',
          message: 'Only admin can change user roles.'
        }
      });
    }

    const role = String(req.body?.role || '').trim().toLowerCase();
    if (!ALLOWED_ROLE_VALUES.has(role)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ROLE',
          message: 'Role must be one of user, moderator, support, admin.'
        }
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    if (String(user._id) === String(req.adminUser?._id)) {
      return deny(res, 'ADMIN_SELF_ROLE_FORBIDDEN', 'You cannot change your own role.');
    }

    user.role = role;
    await user.save();
    await logModerationAction(req, 'set-user-role', 'user', user._id, { role });
    return res.json({ message: `User role updated to ${role}.` });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_ROLE_UPDATE_FAILED',
        message: 'Could not update user role.'
      }
    });
  }
});

router.post('/users/:id/promote-support', async (req, res) => {
  try {
    if (!canManageRoles(req.adminUser?.role)) {
      return res.status(403).json({
        error: {
          code: 'ADMIN_ROLE_FORBIDDEN',
          message: 'Only admin can change user roles.'
        }
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    if (String(user._id) === String(req.adminUser?._id)) {
      return deny(res, 'ADMIN_SELF_ROLE_FORBIDDEN', 'You cannot change your own role.');
    }

    user.role = 'support';
    await user.save();
    await logModerationAction(req, 'set-user-role', 'user', user._id, { role: 'support' });
    return res.json({ message: 'User role updated to support.' });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_ROLE_UPDATE_FAILED',
        message: 'Could not update user role.'
      }
    });
  }
});

router.get('/reports/attachments', async (req, res) => {
  try {
    const status = String(req.query?.status || '').trim().toLowerCase();
    const category = String(req.query?.category || '').trim().toLowerCase();
    const scope = String(req.query?.scope || '').trim().toLowerCase();
    const severity = String(req.query?.severity || '').trim().toLowerCase();
    const paging = parsePaging(req, { limit: 80, max: 200 });
    const filter = status ? { status } : {};

    if (['spam', 'harassment', 'violence', 'sexual', 'copyright', 'other'].includes(category)) {
      filter.category = category;
    }
    if (['public', 'private'].includes(scope)) filter.scope = scope;
    if (['low', 'medium', 'high'].includes(severity)) filter.severity = severity;

    const [reports, total] = await Promise.all([
      AttachmentReport.find(filter)
      .sort({ createdAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .lean(),
      AttachmentReport.countDocuments(filter)
    ]);
    return res.json({
      items: reports,
      paging: {
        page: paging.page,
        limit: paging.limit,
        total,
        pages: Math.max(1, Math.ceil(total / paging.limit))
      }
    });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_ATTACHMENT_REPORTS_FAILED',
        message: 'Could not load attachment reports.'
      }
    });
  }
});

router.get('/reports/attachments/:id', async (req, res) => {
  try {
    const report = await AttachmentReport.findById(req.params.id).lean();
    if (!report) {
      return res.status(404).json({
        error: { code: 'REPORT_NOT_FOUND', message: 'Report not found.' }
      });
    }

    const MessageModel = report.scope === 'private' ? PrivateMessage : PublicMessage;
    const message = await MessageModel.findById(report.messageId)
      .select('_id from to text attachments attachment ts deletedAt')
      .lean();

    return res.json({ report, message: message || null });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_ATTACHMENT_REPORT_DETAIL_FAILED',
        message: 'Could not load report detail.'
      }
    });
  }
});

router.patch('/reports/attachments/:id', async (req, res) => {
  try {
    if (!hasCapability(req.adminUser?.role, 'moderate_reports')) {
      return deny(res, 'ADMIN_PERMISSION_DENIED', 'You do not have permission to update reports.');
    }

    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['pending', 'in_review', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REPORT_STATUS',
          message: 'Status must be pending, in_review, resolved, or dismissed.'
        }
      });
    }

    const report = await AttachmentReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({
        error: { code: 'REPORT_NOT_FOUND', message: 'Report not found.' }
      });
    }

    report.status = status;
    await report.save();
    await logModerationAction(req, 'update-report-status', 'report', report._id, { status });
    return res.json({ message: 'Report status updated.' });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_ATTACHMENT_REPORT_UPDATE_FAILED',
        message: 'Could not update report status.'
      }
    });
  }
});

router.post('/messages/:scope/:id/remove', async (req, res) => {
  try {
    if (!hasCapability(req.adminUser?.role, 'moderate_messages')) {
      return deny(res, 'ADMIN_PERMISSION_DENIED', 'You do not have permission to remove messages.');
    }

    const scope = String(req.params.scope || '').trim().toLowerCase();
    const MessageModel = scope === 'public' ? PublicMessage : scope === 'private' ? PrivateMessage : null;
    if (!MessageModel) {
      return res.status(400).json({
        error: {
          code: 'INVALID_SCOPE',
          message: 'Message scope must be public or private.'
        }
      });
    }

    const message = await MessageModel.findById(req.params.id);
    if (!message) {
      return res.status(404).json({
        error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found.' }
      });
    }

    const author = await User.findOne({ username: String(message.from || '').trim().toLowerCase() }).select('_id role').lean();
    if (author && !canAdminUserActOnTarget(req, author)) {
      return deny(res, 'ADMIN_TARGET_FORBIDDEN', 'You cannot moderate this message author.');
    }

    message.text = 'Message removed by moderation';
    message.attachment = null;
    message.attachments = [];
    message.deletedAt = new Date();
    message.reactions = [];
    await message.save();
    await logModerationAction(req, 'remove-message', 'message', message._id, { scope });

    return res.json({ message: 'Message removed.' });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_MESSAGE_REMOVE_FAILED',
        message: 'Could not remove message.'
      }
    });
  }
});

router.get('/audit-actions', async (req, res) => {
  try {
    const action = String(req.query?.action || '').trim();
    const actorUsername = String(req.query?.actor || '').trim().toLowerCase();
    const targetType = String(req.query?.targetType || '').trim().toLowerCase();
    const paging = parsePaging(req, { limit: 60, max: 200 });
    const filter = {};
    if (action) filter.action = action;
    if (actorUsername) filter.actorUsername = actorUsername;
    if (['user', 'report', 'message', 'system'].includes(targetType)) filter.targetType = targetType;

    const [items, total] = await Promise.all([
      ModerationAction.find(filter)
        .sort({ createdAt: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .lean(),
      ModerationAction.countDocuments(filter)
    ]);

    return res.json({
      items,
      paging: {
        page: paging.page,
        limit: paging.limit,
        total,
        pages: Math.max(1, Math.ceil(total / paging.limit))
      }
    });
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_AUDIT_EVENTS_FAILED',
        message: 'Could not load moderation audit actions.'
      }
    });
  }
});

module.exports = router;
