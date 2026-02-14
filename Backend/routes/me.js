const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

router.get('/', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('_id username email emailVerified role avatarUrl createdAt');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        console.error('Error fetching user:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/profile', auth, async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const avatarUrl = String(req.body?.avatarUrl || '').trim();

    if (!username) {
      return res.status(400).json({
        error: {
          code: 'MISSING_USERNAME',
          message: 'Username is required.'
        }
      });
    }

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_USERNAME',
          message: 'Username must be 3-24 chars using lowercase letters, numbers, or underscores.'
        }
      });
    }

    if (avatarUrl && !/^https?:\/\/.+/.test(avatarUrl)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AVATAR_URL',
          message: 'Avatar URL must be a valid http(s) URL.'
        }
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found.'
        }
      });
    }

    const existing = await User.findOne({ username }).select('_id').lean();
    if (existing && String(existing._id) !== String(user._id)) {
      return res.status(409).json({
        error: {
          code: 'USERNAME_TAKEN',
          message: 'Username already exists.'
        }
      });
    }

    user.username = username;
    user.avatarUrl = avatarUrl || '';
    await user.save();

    return res.json({
      message: 'Profile updated.',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email || null,
        emailVerified: !!user.emailVerified,
        role: user.role,
        avatarUrl: user.avatarUrl || '',
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    return res.status(500).json({
      error: {
        code: 'PROFILE_UPDATE_FAILED',
        message: 'Could not update profile.'
      }
    });
  }
});

module.exports = router;
