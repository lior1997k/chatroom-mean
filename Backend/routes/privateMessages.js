const express = require('express');
const router = express.Router();
const PrivateMessage = require('../models/PrivateMessage');
const authMiddleware = require('../middleware/auth'); 

router.get('/:username', authMiddleware, async (req, res) => {
  const currentUser = req.user.username;
  const otherUser = req.params.username;

  try {
    const messages = await PrivateMessage.find({
      $or: [
        { from: currentUser, to: otherUser },
        { from: otherUser, to: currentUser },
      ]
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch private messages' });
  }
});

module.exports = router;
