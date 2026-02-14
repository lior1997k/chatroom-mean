const mongoose = require('mongoose');
const { Schema } = mongoose;

const attachmentReportSchema = new Schema(
  {
    reportedById: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reportedBy: { type: String, required: true },
    messageId: { type: String, required: true, index: true },
    scope: { type: String, enum: ['public', 'private'], required: true },
    attachmentUrl: { type: String, required: true },
    reason: { type: String, default: 'User report' },
    category: {
      type: String,
      enum: ['spam', 'harassment', 'violence', 'sexual', 'copyright', 'other'],
      default: 'other',
      index: true
    },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium', index: true },
    note: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'in_review', 'resolved', 'dismissed'], default: 'pending', index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AttachmentReport', attachmentReportSchema);
