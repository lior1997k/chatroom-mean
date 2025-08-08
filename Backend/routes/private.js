const express = require('express');
const User = require('../models/User');
const PrivateMessage = require('../models/PrivateMessage');
const auth = require('../middleware/auth');

const router = express.Router();

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
      from: m.from, to: m.to, text: m.text, timestamp: m.ts.toISOString()
    })));
  } catch (e) {
    console.error('GET /api/private error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router; // <- critical
