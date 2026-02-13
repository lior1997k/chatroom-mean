const mongoose = require('mongoose');
const { Schema } = mongoose;

const privateMessageSchema = new Schema(
  {
    fromId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    toId:   { type: Schema.Types.ObjectId, ref: 'User', index: true },
    from:   { type: String, index: true },
    to:     { type: String, index: true },
    text:   { type: String, required: true },
    ts:     { type: Date, default: Date.now, index: true },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: false }
);

privateMessageSchema.index({ fromId: 1, toId: 1, ts: 1 });
privateMessageSchema.index({ toId: 1, readAt: 1, ts: -1 });

module.exports = mongoose.model('PrivateMessage', privateMessageSchema);
