const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const PrivateMessage = require('../models/PrivateMessage');
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
    durationSeconds: Number(a.durationSeconds) > 0 ? Math.round(Number(a.durationSeconds)) : undefined,
    waveform: Array.isArray(a.waveform)
      ? a.waveform.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0).slice(0, 96)
      : undefined,
    audioKind: a.audioKind === 'voice-note' || a.audioKind === 'uploaded-audio' ? a.audioKind : undefined,
    width: Number(a.width) > 0 ? Math.round(Number(a.width)) : undefined,
    height: Number(a.height) > 0 ? Math.round(Number(a.height)) : undefined,
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

function serializeReference(ref, fallbackScope) {
  if (!ref?.messageId) return null;
  const attachments = serializeAttachments(ref);
  return {
    messageId: ref.messageId.toString(),
    from: ref.from || '',
    text: ref.text || '',
    scope: ref.scope || fallbackScope,
    attachment: attachments[0] || null,
    attachments
  };
}

function serializeAudioPlayback(playback) {
  if (!playback || typeof playback !== 'object') return null;
  const progress = Number(playback.progress || 0);
  const currentTimeSeconds = Number(playback.currentTimeSeconds || 0);
  const durationSeconds = Number(playback.durationSeconds || 0);
  const listenedAt = playback.listenedAt ? new Date(playback.listenedAt) : null;

  if (!Number.isFinite(progress) || progress <= 0) return null;

  return {
    by: playback.by || '',
    progress: Math.max(0, Math.min(1, progress)),
    currentTimeSeconds: Number.isFinite(currentTimeSeconds) && currentTimeSeconds >= 0 ? Math.round(currentTimeSeconds) : 0,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? Math.round(durationSeconds) : 0,
    attachmentKey: playback.attachmentKey || undefined,
    listenedAt: listenedAt && !Number.isNaN(listenedAt.getTime()) ? listenedAt.toISOString() : null
  };
}

router.get('/unread-counts', auth, async (req, res) => {
  try {
    const meId = req.user.id;

    const counts = await PrivateMessage.aggregate([
      {
        $match: {
          toId: new mongoose.Types.ObjectId(meId),
          readAt: null
        }
      },
      {
        $group: {
          _id: '$from',
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          username: '$_id',
          count: 1
        }
      }
    ]);

    res.json(counts);
  } catch (e) {
    console.error('GET /api/private/unread-counts error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:username', auth, async (req, res) => {
  try {
    const meId = req.user.id;
    const other = await User.findOne({ username: req.params.username });
    if (!other) return res.json([]);

    const query = {
      $or: [{ fromId: meId, toId: other._id }, { fromId: other._id, toId: meId }]
    };

    if (req.query.since) {
      const since = new Date(req.query.since);
      if (Number.isNaN(since.getTime())) {
        return res.status(400).json({ error: 'Invalid since timestamp' });
      }
      query.ts = { $gt: since };
    }

    const msgs = await PrivateMessage.find(query)
    .sort({ ts: 1 })
    .limit(req.query.since ? 200 : 100)
    .lean();

    res.json(msgs.map(m => ({
      id: m._id.toString(),
      from: m.from,
      to: m.to,
      text: m.text,
      attachment: serializeAttachment(m.attachment),
      attachments: serializeAttachments(m),
      replyTo: serializeReference(m.replyTo, 'private'),
      forwardedFrom: serializeReference(m.forwardedFrom, 'private'),
      timestamp: m.ts.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
      audioPlayback: serializeAudioPlayback(m.audioPlayback),
      reactions: m.reactions || [],
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null
    })));
  } catch (e) {
    console.error('GET /api/private error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/by-id/:id', auth, async (req, res) => {
  try {
    const meId = String(req.user.id);
    const msg = await PrivateMessage.findById(req.params.id).lean();
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const participants = [String(msg.fromId), String(msg.toId)];
    if (!participants.includes(meId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({
      id: msg._id.toString(),
      from: msg.from,
      to: msg.to,
      text: msg.text,
      attachment: serializeAttachment(msg.attachment),
      attachments: serializeAttachments(msg),
      replyTo: serializeReference(msg.replyTo, 'private'),
      forwardedFrom: serializeReference(msg.forwardedFrom, 'private'),
      timestamp: msg.ts.toISOString(),
      readAt: msg.readAt ? msg.readAt.toISOString() : null,
      audioPlayback: serializeAudioPlayback(msg.audioPlayback),
      reactions: msg.reactions || [],
      editedAt: msg.editedAt ? msg.editedAt.toISOString() : null,
      deletedAt: msg.deletedAt ? msg.deletedAt.toISOString() : null
    });
  } catch (e) {
    console.error('GET /api/private/by-id error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; // <- critical
