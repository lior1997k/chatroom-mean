const mongoose = require('mongoose');
const { Schema } = mongoose;

const publicMessageSchema = new Schema(
  {
    fromId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    from: { type: String, required: true, index: true },
    text: { type: String, default: '' },
    attachment: {
      url: { type: String, default: null },
      name: { type: String, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: null },
      isImage: { type: Boolean, default: false },
      durationSeconds: { type: Number, default: null },
      waveform: { type: [Number], default: [] },
      audioKind: { type: String, enum: ['voice-note', 'uploaded-audio'], default: null },
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
          audioKind: { type: String, enum: ['voice-note', 'uploaded-audio'], default: null },
          width: { type: Number, default: null },
          height: { type: Number, default: null }
        }
      ],
      default: []
    },
    replyTo: {
      messageId: { type: Schema.Types.ObjectId, ref: 'PublicMessage', default: null },
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
        audioKind: { type: String, enum: ['voice-note', 'uploaded-audio'], default: null },
        width: { type: Number, default: null },
        height: { type: Number, default: null }
      }
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
    ts: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false }
);

publicMessageSchema.index({ ts: -1 });

module.exports = mongoose.model('PublicMessage', publicMessageSchema);
