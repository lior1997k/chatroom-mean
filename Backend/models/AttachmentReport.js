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
    status: { type: String, enum: ['pending', 'reviewed'], default: 'pending', index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AttachmentReport', attachmentReportSchema);
