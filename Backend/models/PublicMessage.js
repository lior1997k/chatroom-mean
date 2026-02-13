const mongoose = require('mongoose');
const { Schema } = mongoose;

const publicMessageSchema = new Schema(
  {
    fromId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    from: { type: String, required: true, index: true },
    text: { type: String, required: true },
    ts: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false }
);

publicMessageSchema.index({ ts: -1 });

module.exports = mongoose.model('PublicMessage', publicMessageSchema);
