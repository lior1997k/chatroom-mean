const express = require('express');
const PublicMessage = require('../models/PublicMessage');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const limitRaw = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(limitRaw, 1), 100);

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
      timestamp: m.ts.toISOString()
    }));

    res.json({ messages, hasMore });
  } catch (e) {
    console.error('GET /api/public error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
