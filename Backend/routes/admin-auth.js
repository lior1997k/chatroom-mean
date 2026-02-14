const express = require('express');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AuthAbuseEvent = require('../models/AuthAbuseEvent');
const AttachmentReport = require('../models/AttachmentReport');
const PublicMessage = require('../models/PublicMessage');
const PrivateMessage = require('../models/PrivateMessage');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/admin');

const router = express.Router();
const ALLOWED_ROLE_VALUES = new Set(['user', 'moderator', 'support', 'admin']);

function canManageRoles(role) {
  return String(role || '') === 'admin';
}

router.use(auth, requireAdmin);

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 30)));
    const filter = q
      ? {
        $or: [
          { username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
        ]
      }
      : {};

    const users = await User.find(filter)
      .select('_id username email emailVerified role avatarUrl loginFailures lockUntil lastLoginAt createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json(users);
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
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    user.emailVerificationRequestedAt = null;
    await user.save();

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
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    user.loginFailures = 0;
    user.lockUntil = null;
    await user.save();

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
    const user = await User.findById(req.params.id).lean();
    if (!user) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    await AuthSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
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
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 80)));
    const events = await AuthAbuseEvent.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json(events);
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

    user.role = role;
    await user.save();
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

    user.role = 'support';
    await user.save();
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
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 80)));
    const filter = status ? { status } : {};
    const reports = await AttachmentReport.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json(reports);
  } catch {
    return res.status(500).json({
      error: {
        code: 'ADMIN_ATTACHMENT_REPORTS_FAILED',
        message: 'Could not load attachment reports.'
      }
    });
  }
});

router.patch('/reports/attachments/:id', async (req, res) => {
  try {
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

    message.text = 'Message removed by moderation';
    message.attachment = null;
    message.attachments = [];
    message.deletedAt = new Date();
    message.reactions = [];
    await message.save();

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

module.exports = router;
