const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { signToken } = require('../utils/jwt');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const exists = await User.findOne({ username });
  if (exists) return res.status(400).json({ error: 'Username already exists' });

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ username, password: hashed });

  const token = signToken({ id: user._id, username: user.username });
  res.json({ message: 'User registered', token, user: { _id: user._id, username: user.username, avatarUrl: user.avatarUrl } });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: 'Invalid username or password' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Invalid username or password' });

  const token = signToken({ id: user._id, username: user.username });
  res.json({ message: 'Login successful', token, user: { _id: user._id, username: user.username, avatarUrl: user.avatarUrl } });
});

module.exports = router;
