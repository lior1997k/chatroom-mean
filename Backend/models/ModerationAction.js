const mongoose = require('mongoose');
const { Schema } = mongoose;

const moderationActionSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorUsername: { type: String, required: true, index: true },
    actorRole: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, enum: ['user', 'report', 'message', 'system'], required: true, index: true },
    targetId: { type: String, default: '', index: true },
    details: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ModerationAction', moderationActionSchema);
