const mongoose = require('mongoose');

const PrivateMessageSchema = new mongoose.Schema({
  fromId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  toId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  from:   { type: String, required: true },
  to:     { type: String, required: true },

  // Text content (optional for voice)
  text:   { type: String },

  // Voice fields
  kind:       { type: String, enum: ['text', 'voice'], default: 'text' },
  mediaUrl:   { type: String },
  durationMs: { type: Number },

  ts: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('PrivateMessage', PrivateMessageSchema);
