const express = require('express');
const mongoose = require('mongoose');

const auth = require('../middleware/auth');
const PublicMessage = require('../models/PublicMessage');
const PrivateMessage = require('../models/PrivateMessage');

const router = express.Router();

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ query: q, results: [] });

    const limitRaw = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitRaw) ? 40 : Math.min(Math.max(limitRaw, 1), 100);

    const regex = new RegExp(escapeRegex(q), 'i');
    const meId = new mongoose.Types.ObjectId(req.user.id);
    const meUsername = req.user.username;

    const [publicRows, privateRows] = await Promise.all([
      PublicMessage.find({ text: regex, deletedAt: null })
        .sort({ ts: -1 })
        .limit(limit)
        .lean(),
      PrivateMessage.find({
        text: regex,
        deletedAt: null,
        $or: [{ fromId: meId }, { toId: meId }]
      })
        .sort({ ts: -1 })
        .limit(limit)
        .lean()
    ]);

    const results = [
      ...publicRows.map((m) => ({
        scope: 'public',
        id: m._id.toString(),
        from: m.from,
        to: null,
        thread: 'public',
        text: m.text,
        timestamp: m.ts.toISOString(),
        editedAt: m.editedAt ? m.editedAt.toISOString() : null
      })),
      ...privateRows.map((m) => ({
        scope: 'private',
        id: m._id.toString(),
        from: m.from,
        to: m.to,
        thread: m.from === meUsername ? m.to : m.from,
        text: m.text,
        timestamp: m.ts.toISOString(),
        editedAt: m.editedAt ? m.editedAt.toISOString() : null
      }))
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return res.json({ query: q, results });
  } catch (e) {
    console.error('GET /api/search error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
