const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PrivateMessage = require('../models/PrivateMessage');

const router = express.Router();

function auth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// GET /api/private/:username  -> full history (text + voice)
router.get('/:username', auth, async (req, res) => {
  try {
    const meId = req.user.id;
    const other = await User.findOne({ username: req.params.username }).lean();
    if (!other) return res.json([]);

    const docs = await PrivateMessage.find({
      $or: [
        { fromId: meId, toId: other._id },
        { fromId: other._id, toId: meId }
      ]
    }).sort({ ts: 1 }).lean();

    const out = docs.map(d => ({
      id:        d._id.toString(),
      from:      d.from,
      to:        d.to,
      kind:      d.kind,       // <-- keep kind
      text:      d.text,
      mediaUrl:  d.mediaUrl,   // <-- keep voice fields
      durationMs:d.durationMs, // <-- keep voice fields
      timestamp: d.ts?.toISOString(),
    }));

    res.json(out);
  } catch (e) {
    console.error('history error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
