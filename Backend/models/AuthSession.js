const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true, index: true },
    tokenFamily: { type: String, required: true, index: true },
    replacedBySessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    expiresAt: { type: Date, required: true, index: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuthSession', authSessionSchema);
