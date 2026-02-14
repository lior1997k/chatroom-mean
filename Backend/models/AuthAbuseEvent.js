const mongoose = require('mongoose');

const authAbuseEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true },
    ip: { type: String, default: '', index: true },
    identifier: { type: String, default: '', index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    severity: { type: Number, default: 1 }
  },
  { timestamps: true }
);

authAbuseEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('AuthAbuseEvent', authAbuseEventSchema);
