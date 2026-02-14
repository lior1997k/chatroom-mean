const express = require('express');
const PublicMessage = require('../models/PublicMessage');
const auth = require('../middleware/auth');

const router = express.Router();

function serializeAttachment(a) {
  if (!a?.url) return null;
  return {
    url: a.url,
    name: a.name || 'Attachment',
    mimeType: a.mimeType || 'application/octet-stream',
    size: a.size || 0,
    isImage: !!a.isImage,
    storageProvider: a.storageProvider || 'local',
    objectKey: a.objectKey || undefined
  };
}

function serializeAttachments(m) {
  const fromArray = Array.isArray(m?.attachments) ? m.attachments : [];
  const normalized = fromArray.map(serializeAttachment).filter(Boolean);
  if (normalized.length) return normalized;
  const single = serializeAttachment(m?.attachment);
  return single ? [single] : [];
}

router.get('/', auth, async (req, res) => {
  try {
    const limitRaw = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(limitRaw, 1), 100);

    if (req.query.since) {
      const since = new Date(req.query.since);
      if (Number.isNaN(since.getTime())) {
        return res.status(400).json({ error: 'Invalid since timestamp' });
      }

      const docs = await PublicMessage.find({ ts: { $gt: since } })
        .sort({ ts: 1 })
        .limit(200)
        .lean();

        const messages = docs.map((m) => ({
          id: m._id.toString(),
          from: m.from,
          text: m.text,
          attachment: serializeAttachment(m.attachment),
          attachments: serializeAttachments(m),
          replyTo: m.replyTo?.messageId
            ? {
              messageId: m.replyTo.messageId.toString(),
              from: m.replyTo.from || '',
              text: m.replyTo.text || '',
              scope: m.replyTo.scope || 'public',
              attachment: serializeAttachment(m.replyTo.attachment)
            }
            : null,
          timestamp: m.ts.toISOString(),
          reactions: m.reactions || [],
          editedAt: m.editedAt ? m.editedAt.toISOString() : null,
          deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null
        }));

      return res.json({ messages, hasMore: false });
    }

    const query = {};
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!Number.isNaN(before.getTime())) query.ts = { $lt: before };
    }

    const docs = await PublicMessage.find(query)
      .sort({ ts: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const messages = page.reverse().map((m) => ({
      id: m._id.toString(),
      from: m.from,
      text: m.text,
      attachment: serializeAttachment(m.attachment),
      attachments: serializeAttachments(m),
      replyTo: m.replyTo?.messageId
        ? {
          messageId: m.replyTo.messageId.toString(),
          from: m.replyTo.from || '',
          text: m.replyTo.text || '',
          scope: m.replyTo.scope || 'public',
          attachment: serializeAttachment(m.replyTo.attachment)
        }
        : null,
      timestamp: m.ts.toISOString(),
      reactions: m.reactions || [],
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null
    }));

    res.json({ messages, hasMore });
  } catch (e) {
    console.error('GET /api/public error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const message = await PublicMessage.findById(req.params.id).lean();
    if (!message) return res.status(404).json({ error: 'Message not found' });

    res.json({
      id: message._id.toString(),
      from: message.from,
      text: message.text,
      attachment: serializeAttachment(message.attachment),
      attachments: serializeAttachments(message),
      replyTo: message.replyTo?.messageId
        ? {
          messageId: message.replyTo.messageId.toString(),
          from: message.replyTo.from || '',
          text: message.replyTo.text || '',
          scope: message.replyTo.scope || 'public',
          attachment: serializeAttachment(message.replyTo.attachment)
        }
        : null,
      timestamp: message.ts.toISOString(),
      reactions: message.reactions || [],
      editedAt: message.editedAt ? message.editedAt.toISOString() : null,
      deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null
    });
  } catch (e) {
    console.error('GET /api/public/:id error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
