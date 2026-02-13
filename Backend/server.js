const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('./models/User');
const PrivateMessage = require('./models/PrivateMessage');
const PublicMessage = require('./models/PublicMessage');

const userRoutes = require('./routes/user');
const meRoutes = require('./routes/me');
const privateRoutes = require('./routes/private');
const publicRoutes = require('./routes/public');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:4200',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use('/api/user', userRoutes);
app.use('/api/me', meRoutes);
app.use('/api/private', privateRoutes);
app.use('/api/public', publicRoutes);

app.get('/', (_, res) => res.send('ChatRoom Server is running'));

// Check if user exists
app.get('/api/users/:username/exists', async (req, res) => {
  try {
    const username = req.params.username;
    const user = await User.findOne({ username }).lean();
    res.json({ exists: !!user });
  } catch (err) {
    console.error('Error checking user existence:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// userId -> Set<socketId>
const socketsByUserId = new Map();
const onlineUsernames = new Set();
const TYPING_TTL_MS = 3000;
const publicTypingActive = new Set();
const publicTypingTimers = new Map();
const privateTypingStates = new Map();
const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '😮', '😢', '🔥']);

function privateTypingKey(from, to) {
  return `${from}::${to}`;
}

function refreshPublicTyping(username) {
  const previous = publicTypingTimers.get(username);
  if (previous) clearTimeout(previous);

  const timer = setTimeout(() => {
    publicTypingTimers.delete(username);
    if (publicTypingActive.delete(username)) {
      io.emit('typing:publicStop', { from: username });
    }
  }, TYPING_TTL_MS);

  publicTypingTimers.set(username, timer);
}

function stopPublicTyping(username, shouldBroadcast = true) {
  const timer = publicTypingTimers.get(username);
  if (timer) {
    clearTimeout(timer);
    publicTypingTimers.delete(username);
  }

  const wasActive = publicTypingActive.delete(username);
  if (wasActive && shouldBroadcast) {
    io.emit('typing:publicStop', { from: username });
  }
}

function refreshPrivateTyping(from, to, toUserId) {
  const key = privateTypingKey(from, to);
  const existing = privateTypingStates.get(key);

  if (!existing) {
    io.to(`user:${toUserId}`).emit('typing:private', { from, to });
  } else {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    const state = privateTypingStates.get(key);
    if (!state) return;

    privateTypingStates.delete(key);
    io.to(`user:${state.toUserId}`).emit('typing:privateStop', { from: state.from, to: state.to });
  }, TYPING_TTL_MS);

  privateTypingStates.set(key, { timer, from, to, toUserId });
}

function stopPrivateTyping(from, to, shouldBroadcast = true) {
  const key = privateTypingKey(from, to);
  const state = privateTypingStates.get(key);
  if (!state) return;

  clearTimeout(state.timer);
  privateTypingStates.delete(key);

  if (shouldBroadcast) {
    io.to(`user:${state.toUserId}`).emit('typing:privateStop', { from: state.from, to: state.to });
  }
}

function normalizeReactions(reactions) {
  return (reactions || [])
    .filter((r) => r?.emoji)
    .map((r) => ({ emoji: r.emoji, users: Array.from(new Set(r.users || [])) }));
}

function toggleReactionEntries(reactions, emoji, username) {
  const next = normalizeReactions(reactions);
  const sameEntry = next.find((r) => r.emoji === emoji);
  const hadSameReaction = !!sameEntry?.users.includes(username);

  next.forEach((entry) => {
    entry.users = (entry.users || []).filter((u) => u !== username);
  });

  if (!hadSameReaction) {
    const target = next.find((r) => r.emoji === emoji);
    if (target) {
      target.users.push(username);
    } else {
      next.push({ emoji, users: [username] });
    }
  }

  return next.filter((r) => r.users.length > 0);
}

io.use((socket, next) => {
  const token = socket.handshake.query.token || socket.handshake.auth?.token;
  if (!token) return next(new Error('AUTH_REQUIRED'));
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = user; // { id, username }
    next();
  } catch (e) {
    next(new Error('AUTH_INVALID'));
  }
});

function broadcastOnlineUsers() {
  io.emit('onlineUsers', Array.from(onlineUsernames));
}

async function emitUnreadCounts(userId) {
  try {
    const counts = await PrivateMessage.aggregate([
      {
        $match: {
          toId: new mongoose.Types.ObjectId(userId),
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

    io.to(`user:${userId}`).emit('unreadCountsUpdated', { counts });
  } catch (e) {
    console.error('emitUnreadCounts error', e);
  }
}

io.on('connection', (socket) => {
  const { id: userId, username } = socket.user;
  const myRoom = `user:${userId}`;

  socket.join(myRoom);

  if (!socketsByUserId.has(userId)) socketsByUserId.set(userId, new Set());
  socketsByUserId.get(userId).add(socket.id);
  onlineUsernames.add(username);
  broadcastOnlineUsers();
  emitUnreadCounts(userId);

  console.log(`✅ User connected: ${username} (${userId})`);

  // === PUBLIC CHAT ===
  socket.on('publicMessage', async (data) => {
    const text = (data?.text || '').trim();
    if (!text) return;

    try {
      const saved = await PublicMessage.create({
        fromId: userId,
        from: username,
        text
      });

      io.emit('publicMessage', {
        id: saved._id.toString(),
        from: saved.from,
        text: saved.text,
        timestamp: saved.ts.toISOString(),
        reactions: []
      });
    } catch (e) {
      console.error('publicMessage error', e);
      io.emit('publicMessage', {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        from: username,
        text,
        timestamp: new Date().toISOString(),
        reactions: []
      });
    }
  });

  // === PRIVATE CHAT with ACK + DELIVERY ===
  socket.on('privateMessage', async ({ to, text, tempId }) => {
    try {
      stopPrivateTyping(username, to, true);

      const toUser = await User.findOne({ username: to }).lean();
      const timestamp = new Date().toISOString();

      let savedId = tempId || `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      if (toUser) {
        const saved = await PrivateMessage.create({
          fromId: userId,
          toId: toUser._id,
          from: username,
          to,
          text,
          ts: new Date(timestamp),
          readAt: null
        });
        savedId = saved._id.toString();
      }

      // ACK only to sender (prevents duplicate echo)
      io.to(myRoom).emit('privateAck', { tempId, id: savedId, to, timestamp });

      // Deliver to recipient + notify delivered
      if (toUser) {
        const recipientRoom = `user:${toUser._id}`;
        io.to(recipientRoom).emit('privateMessage', {
          id: savedId, from: username, to, text, timestamp, reactions: []
        });
        emitUnreadCounts(toUser._id.toString());
        io.to(myRoom).emit('messageDelivered', { id: savedId, to });
      } else {
        // offline: mark sent
        io.to(myRoom).emit('messageSent', { id: savedId, to });
      }
    } catch (err) {
      console.error('privateMessage error', err);
    }
  });

  // === READ RECEIPT ===
  socket.on('markAsRead', async ({ id, from }) => {
    try {
      if (!id) return;
      await PrivateMessage.updateOne(
        { _id: id, toId: userId, readAt: null },
        { $set: { readAt: new Date() } }
      );

      const fromUser = await User.findOne({ username: from }).lean();
      if (!fromUser) return;
      io.to(`user:${fromUser._id}`).emit('messageRead', { id });
      emitUnreadCounts(userId);
    } catch (e) {
      console.error('markAsRead error', e);
    }
  });

  socket.on('messageReaction', async ({ scope, messageId, emoji }) => {
    try {
      if (!messageId || !emoji || !ALLOWED_REACTIONS.has(emoji)) return;

      if (scope === 'public') {
        const message = await PublicMessage.findById(messageId);
        if (!message) return;

        message.reactions = toggleReactionEntries(message.reactions, emoji, username);
        await message.save();

        io.emit('messageReactionUpdated', {
          scope: 'public',
          messageId,
          reactions: normalizeReactions(message.reactions)
        });
        return;
      }

      if (scope === 'private') {
        const message = await PrivateMessage.findById(messageId);
        if (!message) return;

        const participants = [String(message.fromId), String(message.toId)];
        if (!participants.includes(String(userId))) return;

        message.reactions = toggleReactionEntries(message.reactions, emoji, username);
        await message.save();

        const payload = {
          scope: 'private',
          messageId,
          reactions: normalizeReactions(message.reactions)
        };

        io.to(`user:${participants[0]}`).emit('messageReactionUpdated', payload);
        io.to(`user:${participants[1]}`).emit('messageReactionUpdated', payload);
      }
    } catch (e) {
      console.error('messageReaction error', e);
    }
  });

  // === TYPING INDICATORS ===
  socket.on('typing:public', () => {
    if (!publicTypingActive.has(username)) {
      publicTypingActive.add(username);
      socket.broadcast.emit('typing:public', { from: username });
    }

    refreshPublicTyping(username);
  });

  socket.on('typing:publicStop', () => {
    stopPublicTyping(username, true);
  });

  socket.on('typing:private', async ({ to }) => {
    try {
      if (!to) return;
      const toUser = await User.findOne({ username: to }).lean();
      if (!toUser) return;

      refreshPrivateTyping(username, to, toUser._id.toString());
    } catch (e) {
      console.error('typing:private error', e);
    }
  });

  socket.on('typing:privateStop', async ({ to }) => {
    try {
      if (!to) return;
      stopPrivateTyping(username, to, true);
    } catch (e) {
      console.error('typing:privateStop error', e);
    }
  });

  socket.on('disconnect', () => {
    stopPublicTyping(username, true);

    for (const [key, state] of privateTypingStates.entries()) {
      if (state.from !== username) continue;
      clearTimeout(state.timer);
      privateTypingStates.delete(key);
      io.to(`user:${state.toUserId}`).emit('typing:privateStop', { from: state.from, to: state.to });
    }

    const set = socketsByUserId.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        socketsByUserId.delete(userId);
        onlineUsernames.delete(username);
        broadcastOnlineUsers();
      }
    }
    console.log(`❌ User disconnected: ${username} (${userId})`);
  });
});

const PORT = process.env.PORT || 3000;
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => server.listen(PORT, () => console.log(`Server on ${PORT}`)))
  .catch((err) => console.error('Mongo error', err));
