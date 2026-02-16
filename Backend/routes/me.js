const express = require('express');
const bcrypt = require('bcrypt');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

function passwordPolicyIssues(passwordRaw) {
  const password = String(passwordRaw || '');
  const issues = [];
  if (password.length < 8) issues.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) issues.push('an uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('a lowercase letter');
  if (!/[0-9]/.test(password)) issues.push('a number');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('a symbol');
  return issues;
}

function cleanText(value, max = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

router.get('/', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({
            _id: user._id,
            username: user.username,
            email: user.email || null,
            emailVerified: !!user.emailVerified,
            role: user.role,
            avatarUrl: user.avatarUrl || '',
            displayName: user.displayName || '',
            bio: user.bio || '',
            statusText: user.statusText || '',
            timezone: user.timezone || 'UTC',
            lastSeenVisibility: user.lastSeenVisibility || 'everyone',
            gender: user.gender || 'other',
            birthDate: user.birthDate,
            showAge: user.showAge !== false,
            showCountry: !!user.showCountry,
            countryCode: user.countryCode || '',
            socialLinks: user.socialLinks || { facebook: '', instagram: '', tiktok: '', twitter: '', website: '' },
            privacySettings: user.privacySettings || { showGender: true, showOnlineStatus: true },
            preferences: user.preferences || {
                theme: 'system',
                notificationsEnabled: true,
                soundEnabled: true,
                messagePreview: true,
                autoplayMedia: true,
                compactMode: false,
                showTyping: true,
                readReceipts: true,
                whoCanMessage: 'everyone'
            },
            age: user.age,
            isBirthdayToday: user.isBirthdayToday,
            createdAt: user.createdAt,
            lastLoginAt: user.lastLoginAt || null
        });
    } catch (err) {
        console.error('Error fetching user:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/profile', auth, async (req, res) => {
  try {
    const username = Object.prototype.hasOwnProperty.call(req.body || {}, 'username')
      ? String(req.body?.username || '').trim().toLowerCase()
      : null;
    const hasAvatarUrl = Object.prototype.hasOwnProperty.call(req.body || {}, 'avatarUrl');
    const avatarUrl = hasAvatarUrl ? String(req.body?.avatarUrl || '').trim() : null;
    const hasDisplayName = Object.prototype.hasOwnProperty.call(req.body || {}, 'displayName');
    const hasBio = Object.prototype.hasOwnProperty.call(req.body || {}, 'bio');
    const hasStatusText = Object.prototype.hasOwnProperty.call(req.body || {}, 'statusText');
    const hasTimezone = Object.prototype.hasOwnProperty.call(req.body || {}, 'timezone');
    const hasLastSeenVisibility = Object.prototype.hasOwnProperty.call(req.body || {}, 'lastSeenVisibility');
    const hasGender = Object.prototype.hasOwnProperty.call(req.body || {}, 'gender');
    const hasBirthDate = Object.prototype.hasOwnProperty.call(req.body || {}, 'birthDate');
    const hasShowAge = Object.prototype.hasOwnProperty.call(req.body || {}, 'showAge');
    const hasShowCountry = Object.prototype.hasOwnProperty.call(req.body || {}, 'showCountry');
    const hasCountryCode = Object.prototype.hasOwnProperty.call(req.body || {}, 'countryCode');
    const hasSocialLinks = Object.prototype.hasOwnProperty.call(req.body || {}, 'socialLinks');
    const hasPrivacySettings = Object.prototype.hasOwnProperty.call(req.body || {}, 'privacySettings');
    const displayName = hasDisplayName ? cleanText(req.body?.displayName, 60) : null;
    const bio = hasBio ? cleanText(req.body?.bio, 240) : null;
    const statusText = hasStatusText ? cleanText(req.body?.statusText, 120) : null;
    const timezone = hasTimezone ? cleanText(req.body?.timezone, 64) : null;
    const lastSeenVisibility = hasLastSeenVisibility ? String(req.body?.lastSeenVisibility || '').trim().toLowerCase() : null;
    const gender = hasGender ? String(req.body?.gender || 'other').trim().toLowerCase() : null;
    const birthDate = hasBirthDate ? req.body?.birthDate : null;
    const showAge = hasShowAge ? Boolean(req.body?.showAge) : null;
    const showCountry = hasShowCountry ? Boolean(req.body?.showCountry) : null;
    const countryCode = hasCountryCode ? String(req.body?.countryCode || '').trim().toUpperCase() : null;
    const socialLinks = hasSocialLinks ? req.body?.socialLinks : null;
    const privacySettings = hasPrivacySettings ? req.body?.privacySettings : null;

    if (
      avatarUrl &&
      !/^https?:\/\/.+/.test(avatarUrl) &&
      !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(avatarUrl)
    ) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AVATAR_URL',
          message: 'Avatar must be an uploaded file path or valid http(s) URL.'
        }
      });
    }

    if (gender && !['male', 'female', 'other'].includes(gender)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_GENDER',
          message: 'Gender must be male, female, or other.'
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

    if (username && username !== String(user.username || '').trim().toLowerCase()) {
      return res.status(403).json({
        error: {
          code: 'USERNAME_IMMUTABLE',
          message: 'Username cannot be changed after account creation.'
        }
      });
    }

    if (hasAvatarUrl) user.avatarUrl = avatarUrl || '';
    if (hasDisplayName) user.displayName = displayName || '';
    if (hasBio) user.bio = bio || '';
    if (hasStatusText) user.statusText = statusText || '';
    if (hasTimezone) user.timezone = timezone || 'UTC';
    if (hasLastSeenVisibility) {
      if (!['everyone', 'contacts', 'nobody'].includes(lastSeenVisibility)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_LAST_SEEN_VISIBILITY',
            message: 'Last seen visibility must be everyone, contacts, or nobody.'
          }
        });
      }
      user.lastSeenVisibility = lastSeenVisibility;
    }
    if (hasGender) user.gender = gender;
    if (hasBirthDate) {
      if (birthDate) {
        user.birthDate = new Date(birthDate);
      } else {
        user.birthDate = null;
      }
    }
    if (hasShowAge) user.showAge = showAge;
    if (hasShowCountry) user.showCountry = showCountry;
    if (hasCountryCode) user.countryCode = countryCode || '';
    if (hasSocialLinks && socialLinks) {
      user.socialLinks = {
        facebook: String(socialLinks?.facebook || '').trim(),
        instagram: String(socialLinks?.instagram || '').trim(),
        tiktok: String(socialLinks?.tiktok || '').trim(),
        twitter: String(socialLinks?.twitter || '').trim(),
        website: String(socialLinks?.website || '').trim()
      };
    }
    if (hasPrivacySettings && privacySettings) {
      user.privacySettings = {
        showGender: privacySettings?.showGender !== undefined ? Boolean(privacySettings.showGender) : true,
        showOnlineStatus: privacySettings?.showOnlineStatus !== undefined ? Boolean(privacySettings.showOnlineStatus) : true
      };
    }
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
        displayName: user.displayName || '',
        bio: user.bio || '',
        statusText: user.statusText || '',
        timezone: user.timezone || 'UTC',
        lastSeenVisibility: user.lastSeenVisibility || 'everyone',
        gender: user.gender || 'other',
        birthDate: user.birthDate,
        showAge: user.showAge !== false,
        showCountry: !!user.showCountry,
        countryCode: user.countryCode || '',
        socialLinks: user.socialLinks || { facebook: '', instagram: '', tiktok: '', twitter: '', website: '' },
        privacySettings: user.privacySettings || { showGender: true, showOnlineStatus: true },
        age: user.age,
        isBirthdayToday: user.isBirthdayToday,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt || null
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

router.patch('/password', auth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Current password and new password are required.'
        }
      });
    }

    const policyIssues = passwordPolicyIssues(newPassword);
    if (policyIssues.length) {
      return res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: `Password must include ${policyIssues.join(', ')}.`
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

    if (!user.password) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_LOGIN_DISABLED',
          message: 'This account uses social sign-in and cannot change password here.'
        }
      });
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      return res.status(401).json({
        error: {
          code: 'PASSWORD_INCORRECT',
          message: 'Current password is incorrect.'
        }
      });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.passwordChangedAt = new Date();
    user.loginFailures = 0;
    user.lockUntil = null;
    await user.save();

    return res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Error updating password:', err);
    return res.status(500).json({
      error: {
        code: 'PASSWORD_UPDATE_FAILED',
        message: 'Could not update password.'
      }
    });
  }
});

// Get user preferences
router.get('/preferences', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    res.json(user.preferences || {
      theme: 'system',
      notificationsEnabled: true,
      soundEnabled: true,
      messagePreview: true,
      autoplayMedia: true,
      compactMode: false,
      showTyping: true,
      readReceipts: true,
      whoCanMessage: 'everyone'
    });
  } catch (err) {
    console.error('Error fetching preferences:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user preferences
router.patch('/preferences', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const allowedFields = [
      'theme', 'notificationsEnabled', 'soundEnabled', 'messagePreview',
      'autoplayMedia', 'compactMode', 'showTyping', 'readReceipts', 'whoCanMessage'
    ];

    if (!user.preferences) {
      user.preferences = {};
    }

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        user.preferences[field] = req.body[field];
      }
    }

    await user.save();
    res.json(user.preferences);
  } catch (err) {
    console.error('Error updating preferences:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get blocked private senders
router.get('/blocked-private', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('blockedPrivateSenders', 'username displayName avatarUrl');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const blockedList = (user.blockedPrivateSenders || []).map(u => ({
      _id: u._id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl
    }));

    res.json(blockedList);
  } catch (err) {
    console.error('Error fetching blocked list:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Block user from private messages
router.post('/block-private/:userId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const targetUserId = req.params.userId;
    if (targetUserId === String(user._id)) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    if (!user.blockedPrivateSenders) {
      user.blockedPrivateSenders = [];
    }

    if (!user.blockedPrivateSenders.some(id => String(id) === String(targetUserId))) {
      user.blockedPrivateSenders.push(targetUserId);
      await user.save();
    }

    res.json({ message: 'User blocked from private messages' });
  } catch (err) {
    console.error('Error blocking user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unblock user from private messages
router.post('/unblock-private/:userId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const targetUserId = req.params.userId;

    if (user.blockedPrivateSenders) {
      user.blockedPrivateSenders = user.blockedPrivateSenders.filter(
        id => String(id) !== String(targetUserId)
      );
      await user.save();
    }

    res.json({ message: 'User unblocked from private messages' });
  } catch (err) {
    console.error('Error unblocking user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
