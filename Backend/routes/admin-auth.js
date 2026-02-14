const express = require('express');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AuthAbuseEvent = require('../models/AuthAbuseEvent');
const auth = require('../middleware/auth');
const requireAdmin = require('../middleware/admin');

const router = express.Router();

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
      .select('_id username email emailVerified role loginFailures lockUntil lastLoginAt createdAt')
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

router.post('/users/:id/promote-support', async (req, res) => {
  try {
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

module.exports = router;
