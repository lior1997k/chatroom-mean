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
    gender: { type: String, enum: ['male', 'female', 'other'], default: 'other' },
    birthDate: { type: Date, default: null },
    showAge: { type: Boolean, default: true },
    showCountry: { type: Boolean, default: false },
    countryCode: { type: String, default: '' },
    socialLinks: {
      facebook: { type: String, default: '' },
      instagram: { type: String, default: '' },
      tiktok: { type: String, default: '' },
      twitter: { type: String, default: '' },
      website: { type: String, default: '' }
    },
    privacySettings: {
      showGender: { type: Boolean, default: true },
      showOnlineStatus: { type: Boolean, default: true }
    },
    preferences: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
      notificationsEnabled: { type: Boolean, default: true },
      soundEnabled: { type: Boolean, default: true },
      messagePreview: { type: Boolean, default: true },
      autoplayMedia: { type: Boolean, default: true },
      compactMode: { type: Boolean, default: false },
      showTyping: { type: Boolean, default: true },
      readReceipts: { type: Boolean, default: true },
      whoCanMessage: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
      dateFormat: { type: String, enum: ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'], default: 'MM/DD/YYYY' }
    },
    blockedPrivateSenders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.virtual('age').get(function() {
  if (!this.birthDate) return null;
  const today = new Date();
  const birth = new Date(this.birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
});

userSchema.virtual('isBirthdayToday').get(function() {
  if (!this.birthDate) return false;
  const today = new Date();
  const birth = new Date(this.birthDate);
  return today.getDate() === birth.getDate() && today.getMonth() === birth.getMonth();
});

module.exports = mongoose.model('User', userSchema);
