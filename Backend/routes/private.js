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
      timestamp: m.ts.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
      reactions: m.reactions || []
    })));
  } catch (e) {
    console.error('GET /api/private error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; // <- critical
