const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('./models/User');
const PrivateMessage = require('./models/PrivateMessage');

const userRoutes = require('./routes/user');
const meRoutes = require('./routes/me');
const privateRoutes = require('./routes/private');

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

app.get('/', (_, res) => res.send('ChatRoom Server is running'));

// Check if user exists (used by client when adding offline users)
app.get('/api/users/:username/exists', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).lean();
    res.json({ exists: !!user });
  } catch (err) {
    console.error('Error checking user existence:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// userId -> Set<socketId>
const socketsByUserId = new Map();
// Track usernames that are currently online (for broadcast)
const onlineUsernames = new Set();

io.use((socket, next) => {
  const token = socket.handshake.query.token || socket.handshake.auth?.token;
  if (!token) return next(new Error('No token provided'));
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = user; // { id, username }
    next();
  } catch (e) {
    next(new Error('Invalid token'));
  }
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

  // === PUBLIC CHAT ===
  socket.on('publicMessage', (data) => {
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      from: username,
      text: data.text,
      timestamp: new Date().toISOString()
    };
    io.emit('publicMessage', msg);
  });

  // === PRIVATE CHAT with ACK + DELIVERY ===
  socket.on('privateMessage', async ({ to, text, tempId }) => {
    try {
      const toUser = await User.findOne({ username: to }).lean();
      const timestamp = new Date().toISOString();

      // Persist if recipient exists; use DB id when available
      let savedId = tempId || `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      if (toUser) {
        const saved = await PrivateMessage.create({
          fromId: userId,
          toId: toUser._id,
          from: username,
          to,
          text,
          ts: new Date(timestamp)
        });
        savedId = saved._id.toString();
      }

      // 1) ACK back to the SENDER ONLY — map tempId -> real id (prevents duplicate echo)
      io.to(myRoom).emit('privateAck', { tempId, id: savedId, to, timestamp });

      // 2) Deliver full message to RECIPIENT (if online), then notify sender as delivered
      if (toUser) {
        const recipientRoom = `user:${toUser._id}`;
        io.to(recipientRoom).emit('privateMessage', {
          id: savedId,
          from: username,
          to,
          text,
          timestamp
        });

        // sender sees ✓✓ delivered
        io.to(myRoom).emit('messageDelivered', { id: savedId, to });
      } else {
        // Recipient offline — mark as "sent" for the sender (single ✓)
        io.to(myRoom).emit('messageSent', { id: savedId, to });
      }
    } catch (err) {
      console.error('privateMessage error', err);
    }
  });

  // === READ RECEIPT ===
  // Client emits: { id, from } where "from" = original sender's username
  socket.on('markAsRead', async ({ id, from }) => {
    try {
      const fromUser = await User.findOne({ username: from }).lean();
      if (!fromUser) return;
      // Notify the original sender that this message was read (blue ✓✓ on their side)
      io.to(`user:${fromUser._id}`).emit('messageRead', { id });
    } catch (e) {
      console.error('markAsRead error', e);
    }
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

const PORT = process.env.PORT || 3000;
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => server.listen(PORT, () => console.log(`Server on ${PORT}`)))
  .catch((err) => console.error('Mongo error', err));
