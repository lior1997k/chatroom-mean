const express  = require('express');
const cors     = require('cors');
const http     = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const fs       = require('fs');
const cron     = require('node-cron');
require('dotenv').config();

const User            = require('./models/User');
const PrivateMessage  = require('./models/PrivateMessage');

const userRoutes    = require('./routes/user');
const meRoutes      = require('./routes/me');
const privateRoutes = require('./routes/private');
const uploadRoutes  = require('./routes/upload'); // NEW

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:4200', methods: ['GET','POST'] }
});

// static for uploaded audio
const VOICE_DIR = path.join(__dirname, 'uploads', 'voice');
app.use('/static/voice', express.static(VOICE_DIR));

app.use(cors());
app.use(express.json());
app.use('/api/user', userRoutes);
app.use('/api/me', meRoutes);
app.use('/api/private', privateRoutes);
app.use('/api/upload', uploadRoutes); // NEW

app.get('/', (_, res) => res.send('ChatRoom Server is running'));

// quick “exists” endpoint
app.get('/api/users/:username/exists', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).lean();
    res.json({ exists: !!user });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

// connection maps
const socketsByUserId = new Map();
const onlineUsernames = new Set();

io.use((socket, next) => {
  const token = socket.handshake.query.token || socket.handshake.auth?.token;
  if (!token) return next(new Error('No token provided'));
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = user;
    next();
  } catch (e) { next(new Error('Invalid token')); }
});

function broadcastOnlineUsers() {
  io.emit('onlineUsers', Array.from(onlineUsernames));
}

io.on('connection', (socket) => {
  const { id: userId, username } = socket.user;
  const myRoom = `user:${userId}`;
  socket.join(myRoom);

  if (!socketsByUserId.has(userId)) socketsByUserId.set(userId, new Set());
  socketsByUserId.get(userId).add(socket.id);
  onlineUsernames.add(username);
  broadcastOnlineUsers();
  console.log(`✅ User connected: ${username} (${userId})`);

  // PUBLIC text
  socket.on('publicMessage', (data) => {
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'text',
      from: username,
      text: data.text,
      timestamp: new Date().toISOString()
    };
    io.emit('publicMessage', msg);
  });

  // PUBLIC voice
  socket.on('publicVoice', ({ url, durationMs }) => {
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'voice',
      from: username,
      mediaUrl: url,
      durationMs,
      timestamp: new Date().toISOString()
    };
    io.emit('publicMessage', msg);
  });

  // PRIVATE text
  socket.on('privateMessage', async ({ to, text, tempId }) => {
    try {
      const toUser = await User.findOne({ username: to }).lean();
      const timestamp = new Date().toISOString();

      let savedId = tempId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (toUser) {
        const saved = await PrivateMessage.create({
          fromId: userId, toId: toUser._id, from: username, to,
          text, kind: 'text', ts: new Date(timestamp)
        });
        savedId = saved._id.toString();
      }

      io.to(myRoom).emit('privateAck', { tempId, id: savedId, to, timestamp });

      if (toUser) {
        io.to(`user:${toUser._id}`).emit('privateMessage', {
          id: savedId, kind: 'text', from: username, to, text, timestamp
        });
        io.to(myRoom).emit('messageDelivered', { id: savedId, to });
      } else {
        io.to(myRoom).emit('messageSent', { id: savedId, to });
      }
    } catch (err) { console.error('privateMessage error', err); }
  });

  // PRIVATE voice
  socket.on('privateVoice', async ({ to, url, durationMs, tempId }) => {
    try {
      const toUser = await User.findOne({ username: to }).lean();
      const timestamp = new Date().toISOString();

      let savedId = tempId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (toUser) {
        const saved = await PrivateMessage.create({
          fromId: userId, toId: toUser._id, from: username, to,
          kind: 'voice', mediaUrl: url, durationMs, ts: new Date(timestamp)
        });
        savedId = saved._id.toString();
      }

      io.to(myRoom).emit('privateAck', { tempId, id: savedId, to, timestamp });

      if (toUser) {
        io.to(`user:${toUser._id}`).emit('privateMessage', {
          id: savedId, kind: 'voice', from: username, to, mediaUrl: url, durationMs, timestamp
        });
        io.to(myRoom).emit('messageDelivered', { id: savedId, to });
      } else {
        io.to(myRoom).emit('messageSent', { id: savedId, to });
      }
    } catch (err) { console.error('privateVoice error', err); }
  });

  // receipts
  socket.on('markAsRead', async ({ id, from }) => {
    try {
      const fromUser = await User.findOne({ username: from }).lean();
      if (fromUser) io.to(`user:${fromUser._id}`).emit('messageRead', { id });
    } catch (e) { console.error('markAsRead error', e); }
  });

  // typing indicators
  socket.on('typing:public', () => socket.broadcast.emit('typing:public', { from: username }));
  socket.on('typing:publicStop', () => socket.broadcast.emit('typing:publicStop', { from: username }));
  socket.on('typing:private', async ({ to }) => {
    const toUser = await User.findOne({ username: to }).lean();
    if (toUser) io.to(`user:${toUser._id}`).emit('typing:private', { from: username, to });
  });
  socket.on('typing:privateStop', async ({ to }) => {
    const toUser = await User.findOne({ username: to }).lean();
    if (toUser) io.to(`user:${toUser._id}`).emit('typing:privateStop', { from: username, to });
  });

  socket.on('disconnect', () => {
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

// daily cleanup
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
cron.schedule('0 3 * * *', () => {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (!fs.existsSync(VOICE_DIR)) return;
    for (const name of fs.readdirSync(VOICE_DIR)) {
      const p = path.join(VOICE_DIR, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) {
          fs.unlinkSync(p);
          console.log('🧹 Deleted old voice file:', name);
        }
      } catch {}
    }
  } catch (e) { console.error('Cleanup error:', e); }
});

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => server.listen(PORT, () => console.log(`Server on ${PORT}`)))
  .catch(err => console.error('Mongo error', err));
