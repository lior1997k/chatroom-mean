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

    const msgs = await PrivateMessage.find({
      $or: [{ fromId: meId, toId: other._id }, { fromId: other._id, toId: meId }]
    })
    .sort({ ts: 1 })
    .limit(100)
    .lean();

    res.json(msgs.map(m => ({
      id: m._id.toString(),
      from: m.from,
      to: m.to,
      text: m.text,
      timestamp: m.ts.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null
    })));
  } catch (e) {
    console.error('GET /api/private error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; // <- critical
