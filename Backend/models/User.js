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
    googleSub: { type: String, unique: true, sparse: true, index: true, default: null },
    appleSub: { type: String, unique: true, sparse: true, index: true, default: null },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null },
    emailVerificationExpiresAt: { type: Date, default: null },
    emailVerificationRequestedAt: { type: Date, default: null },
    loginFailures: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
