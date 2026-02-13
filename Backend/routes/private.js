const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const PrivateMessage = require('../models/PrivateMessage');
const auth = require('../middleware/auth');

const router = express.Router();

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
      replyTo: m.replyTo?.messageId
        ? {
          messageId: m.replyTo.messageId.toString(),
          from: m.replyTo.from || '',
          text: m.replyTo.text || '',
          scope: m.replyTo.scope || 'private'
        }
        : null,
      forwardedFrom: m.forwardedFrom?.messageId
        ? {
          messageId: m.forwardedFrom.messageId.toString(),
          from: m.forwardedFrom.from || '',
          text: m.forwardedFrom.text || '',
          scope: m.forwardedFrom.scope || 'private'
        }
        : null,
      timestamp: m.ts.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
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
      replyTo: msg.replyTo?.messageId
        ? {
          messageId: msg.replyTo.messageId.toString(),
          from: msg.replyTo.from || '',
          text: msg.replyTo.text || '',
          scope: msg.replyTo.scope || 'private'
        }
        : null,
      forwardedFrom: msg.forwardedFrom?.messageId
        ? {
          messageId: msg.forwardedFrom.messageId.toString(),
          from: msg.forwardedFrom.from || '',
          text: msg.forwardedFrom.text || '',
          scope: msg.forwardedFrom.scope || 'private'
        }
        : null,
      timestamp: msg.ts.toISOString(),
      readAt: msg.readAt ? msg.readAt.toISOString() : null,
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
