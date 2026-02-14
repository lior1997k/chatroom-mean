const mongoose = require('mongoose');
const { Schema } = mongoose;

const privateMessageSchema = new Schema(
  {
    fromId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    toId:   { type: Schema.Types.ObjectId, ref: 'User', index: true },
    from:   { type: String, index: true },
    to:     { type: String, index: true },
    text:   { type: String, default: '' },
    attachment: {
      url: { type: String, default: null },
      name: { type: String, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: null },
      isImage: { type: Boolean, default: false },
      durationSeconds: { type: Number, default: null },
      waveform: { type: [Number], default: [] },
      width: { type: Number, default: null },
      height: { type: Number, default: null }
    },
    attachments: {
      type: [
        {
          url: { type: String, default: null },
          name: { type: String, default: null },
          mimeType: { type: String, default: null },
          size: { type: Number, default: null },
          isImage: { type: Boolean, default: false },
          durationSeconds: { type: Number, default: null },
          waveform: { type: [Number], default: [] },
          width: { type: Number, default: null },
          height: { type: Number, default: null }
        }
      ],
      default: []
    },
    replyTo: {
      messageId: { type: Schema.Types.ObjectId, default: null },
      from: { type: String, default: null },
      text: { type: String, default: null },
      scope: { type: String, enum: ['public', 'private'], default: null },
      attachment: {
        url: { type: String, default: null },
        name: { type: String, default: null },
        mimeType: { type: String, default: null },
        size: { type: Number, default: null },
        isImage: { type: Boolean, default: false },
        durationSeconds: { type: Number, default: null },
        waveform: { type: [Number], default: [] },
        width: { type: Number, default: null },
        height: { type: Number, default: null }
      }
    },
    forwardedFrom: {
      messageId: { type: Schema.Types.ObjectId, default: null },
      from: { type: String, default: null },
      text: { type: String, default: null },
      scope: { type: String, enum: ['public', 'private'], default: null }
    },
    reactions: {
      type: [
        {
          emoji: { type: String, required: true },
          users: [{ type: String }]
        }
      ],
      default: []
    },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    ts:     { type: Date, default: Date.now, index: true },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: false }
);

privateMessageSchema.index({ fromId: 1, toId: 1, ts: 1 });
privateMessageSchema.index({ toId: 1, readAt: 1, ts: -1 });

module.exports = mongoose.model('PrivateMessage', privateMessageSchema);
