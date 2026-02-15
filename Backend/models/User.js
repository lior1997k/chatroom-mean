const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      unique: true,
      required: true,
      index: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 24,
      match: /^[a-z0-9_]{3,24}$/
    },
    email: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
      trim: true,
      lowercase: true,
      maxlength: 254
    },
    password: { type: String, default: null },
    avatarUrl: String,
    displayName: { type: String, default: '', trim: true, maxlength: 60 },
    bio: { type: String, default: '', trim: true, maxlength: 240 },
    statusText: { type: String, default: '', trim: true, maxlength: 120 },
    timezone: { type: String, default: 'UTC', trim: true, maxlength: 64 },
    lastSeenVisibility: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    role: { type: String, enum: ['user', 'moderator', 'support', 'admin'], default: 'user', index: true },
    googleSub: { type: String, unique: true, sparse: true, index: true },
    appleSub: { type: String, unique: true, sparse: true, index: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null },
    emailVerificationExpiresAt: { type: Date, default: null },
    emailVerificationRequestedAt: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },
    passwordResetRequestedAt: { type: Date, default: null },
    loginFailures: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
