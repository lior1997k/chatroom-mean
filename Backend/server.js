const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const crypto = require('crypto');
require('dotenv').config();

const User = require('./models/User');
const PrivateMessage = require('./models/PrivateMessage');
const AttachmentReport = require('./models/AttachmentReport');
const PublicMessage = require('./models/PublicMessage');

const userRoutes = require('./routes/user');
const meRoutes = require('./routes/me');
const privateRoutes = require('./routes/private');
const publicRoutes = require('./routes/public');
const searchRoutes = require('./routes/search');
const auth = require('./middleware/auth');
const { verifyAccessToken } = require('./utils/jwt');

const app = express();
const server = http.createServer(app);
const allowedOrigins = String(process.env.CLIENT_URL || 'http://localhost:4200')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS_NOT_ALLOWED'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => {
      const safeOriginal = String(file.originalname || 'file')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 80);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeOriginal}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_ATTACHMENT_DURATION_SECONDS = 12 * 60 * 60;
const MAX_ATTACHMENT_DIMENSION = 12000;
const CHUNK_SIZE_BYTES = 1024 * 1024;
const DIRECT_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;
const CHUNK_RESUME_TTL_MS = 24 * 60 * 60 * 1000;
const chunkSessions = new Map();
const chunkSessionsByResumeKey = new Map();
const AUDIO_KIND_VALUES = new Set(['voice-note', 'uploaded-audio']);
const ALLOWED_UPLOAD_MIME = [
  /^image\//,
  /^video\//,
  /^audio\//,
  /^text\//,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/,
  /^application\/vnd\.ms-excel$/,
  /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/,
  /^application\/vnd\.ms-powerpoint$/,
  /^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/
];

app.use('/uploads', express.static(uploadsDir));

app.use('/api/user', userRoutes);
app.use('/api/me', meRoutes);
app.use('/api/private', privateRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/search', searchRoutes);

app.post('/api/upload', auth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 50MB)' });
      }
      console.error('Upload middleware error', err);
      return res.status(400).json({ error: 'Upload failed' });
    }

    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const mimeType = req.file.mimetype || 'application/octet-stream';
      const allowed = ALLOWED_UPLOAD_MIME.some((rx) => rx.test(mimeType));
      if (!allowed) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // no-op
        }
        return res.status(415).json({ error: `Unsupported file type: ${mimeType}` });
      }
      const name = req.file.originalname || req.file.filename;
      const isImage = mimeType.startsWith('image/');
      const uploadedDuration = Number(req.body?.durationSeconds);
      const uploadedWaveformRaw = String(req.body?.waveform || '');
      const uploadedWidth = Number(req.body?.width);
      const uploadedHeight = Number(req.body?.height);
      const audioKind = sanitizeAudioKind(req.body?.audioKind, mimeType);
      const durationSeconds = Number.isFinite(uploadedDuration) && uploadedDuration > 0
        ? Math.round(uploadedDuration)
        : undefined;
      const width = Number.isFinite(uploadedWidth) && uploadedWidth > 0 ? Math.round(uploadedWidth) : undefined;
      const height = Number.isFinite(uploadedHeight) && uploadedHeight > 0 ? Math.round(uploadedHeight) : undefined;
      const waveform = parseWaveform(uploadedWaveformRaw);

      return res.json({
        url: `/uploads/${req.file.filename}`,
        name,
        mimeType,
        size: req.file.size || 0,
        isImage,
        durationSeconds,
        waveform,
        audioKind,
        width,
        height,
        storageProvider: 'local',
        objectKey: req.file.filename
      });
    } catch (e) {
      console.error('Upload handler error', e);
      return res.status(500).json({ error: 'Upload failed' });
    }
  });
});

app.post('/api/upload/presign', auth, (_, res) => {
  res.status(501).json({ error: 'Presigned uploads are not configured yet' });
});

app.get('/api/upload/policy', auth, (_, res) => {
  res.json({
    maxBytes: MAX_UPLOAD_BYTES,
    allowedMimePatterns: ALLOWED_UPLOAD_MIME.map((rx) => rx.source),
    chunkSize: CHUNK_SIZE_BYTES,
    directUploadThreshold: DIRECT_UPLOAD_THRESHOLD_BYTES,
    resumeTtlMs: CHUNK_RESUME_TTL_MS
  });
});

function safeChunkDir(sessionId) {
  return path.join(uploadsDir, '_chunk', sessionId);
}

async function deleteChunkSession(sessionId) {
  const existing = chunkSessions.get(sessionId);
  if (!existing) return;
  chunkSessions.delete(sessionId);
  if (existing.resumeKey && chunkSessionsByResumeKey.get(existing.resumeKey) === sessionId) {
    chunkSessionsByResumeKey.delete(existing.resumeKey);
  }
  try {
    await fs.promises.rm(existing.tmpDir, { recursive: true, force: true });
  } catch {
    // no-op
  }
}

async function clearExpiredChunkSessions() {
  const now = Date.now();
  const entries = Array.from(chunkSessions.entries());
  for (const [id, session] of entries) {
    if (now - session.updatedAt > CHUNK_RESUME_TTL_MS) {
      await deleteChunkSession(id);
    }
  }
}

function chunkSessionResponse(session) {
  return {
    sessionId: session.id,
    chunkSize: CHUNK_SIZE_BYTES,
    uploadedChunks: Array.from(session.uploadedChunks).sort((a, b) => a - b),
    totalChunks: session.totalChunks,
    expiresAt: new Date(session.updatedAt + CHUNK_RESUME_TTL_MS).toISOString()
  };
}

app.post('/api/upload/chunk/init', auth, async (req, res) => {
  try {
    await clearExpiredChunkSessions();
    const name = String(req.body?.name || 'file').slice(0, 180);
    const mimeType = String(req.body?.mimeType || 'application/octet-stream').trim();
    const size = Number(req.body?.size || 0);
    const totalChunks = Number(req.body?.totalChunks || 0);
    const resumeKey = String(req.body?.resumeKey || '').trim().slice(0, 180);

    if (!name || !mimeType || !Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'Invalid upload init payload' });
    }

    const allowed = ALLOWED_UPLOAD_MIME.some((rx) => rx.test(mimeType));
    if (!allowed) {
      return res.status(415).json({ error: `Unsupported file type: ${mimeType}` });
    }

    if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 500) {
      return res.status(400).json({ error: 'Invalid chunk count' });
    }

    if (resumeKey) {
      const existingId = chunkSessionsByResumeKey.get(`${req.user.id}:${resumeKey}`);
      const existing = existingId ? chunkSessions.get(existingId) : null;
      if (existing && existing.userId === req.user.id && existing.size === size && existing.mimeType === mimeType) {
        existing.updatedAt = Date.now();
        return res.json(chunkSessionResponse(existing));
      }
    }

    const sessionId = crypto.randomUUID();
    const tmpDir = safeChunkDir(sessionId);
    await fs.promises.mkdir(tmpDir, { recursive: true });

    const session = {
      id: sessionId,
      userId: req.user.id,
      name,
      mimeType,
      size,
      totalChunks,
      uploadedChunks: new Set(),
      tmpDir,
      updatedAt: Date.now(),
      resumeKey: resumeKey ? `${req.user.id}:${resumeKey}` : ''
    };

    chunkSessions.set(sessionId, session);
    if (session.resumeKey) chunkSessionsByResumeKey.set(session.resumeKey, sessionId);

    return res.json(chunkSessionResponse(session));
  } catch (err) {
    console.error('Chunk init error', err);
    return res.status(500).json({ error: 'Could not initialize chunk upload' });
  }
});

app.post('/api/upload/chunk/:sessionId', auth, (req, res) => {
  chunkUpload.single('chunk')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Chunk too large' });
      }
      return res.status(400).json({ error: 'Chunk upload failed' });
    }

    try {
      const session = chunkSessions.get(String(req.params.sessionId || ''));
      if (!session || session.userId !== req.user.id) {
        return res.status(404).json({ error: 'Chunk session not found' });
      }
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'Missing chunk file' });
      }

      const index = Number(req.body?.index);
      if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
        return res.status(400).json({ error: 'Invalid chunk index' });
      }

      const chunkPath = path.join(session.tmpDir, `${index}.part`);
      await fs.promises.writeFile(chunkPath, req.file.buffer);
      session.uploadedChunks.add(index);
      session.updatedAt = Date.now();

      return res.json({
        ok: true,
        uploadedCount: session.uploadedChunks.size,
        totalChunks: session.totalChunks
      });
    } catch (e) {
      console.error('Chunk upload handler error', e);
      return res.status(500).json({ error: 'Could not save chunk' });
    }
  });
});

app.post('/api/upload/chunk/:sessionId/finalize', auth, async (req, res) => {
  try {
    const session = chunkSessions.get(String(req.params.sessionId || ''));
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Chunk session not found' });
    }

    if (session.uploadedChunks.size !== session.totalChunks) {
      return res.status(400).json({ error: 'Upload incomplete' });
    }

    const safeOriginal = String(session.name || 'file')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const finalName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeOriginal}`;
    const finalPath = path.join(uploadsDir, finalName);

    const writer = fs.createWriteStream(finalPath);
    for (let i = 0; i < session.totalChunks; i += 1) {
      const chunkPath = path.join(session.tmpDir, `${i}.part`);
      const data = await fs.promises.readFile(chunkPath);
      writer.write(data);
    }
    writer.end();
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const stat = await fs.promises.stat(finalPath);
    const uploadedDuration = Number(req.body?.durationSeconds);
    const uploadedWaveform = parseWaveform(req.body?.waveform);
    const uploadedWidth = Number(req.body?.width);
    const uploadedHeight = Number(req.body?.height);
    const audioKind = sanitizeAudioKind(req.body?.audioKind, session.mimeType);

    const payload = {
      url: `/uploads/${finalName}`,
      name: session.name,
      mimeType: session.mimeType,
      size: Number(stat.size || session.size || 0),
      isImage: session.mimeType.startsWith('image/'),
      durationSeconds: Number.isFinite(uploadedDuration) && uploadedDuration > 0 ? Math.floor(uploadedDuration) : undefined,
      waveform: uploadedWaveform,
      audioKind,
      width: Number.isFinite(uploadedWidth) && uploadedWidth > 0 ? Math.round(uploadedWidth) : undefined,
      height: Number.isFinite(uploadedHeight) && uploadedHeight > 0 ? Math.round(uploadedHeight) : undefined,
      storageProvider: 'local',
      objectKey: finalName
    };

    await deleteChunkSession(session.id);
    return res.json(payload);
  } catch (err) {
    console.error('Chunk finalize error', err);
    return res.status(500).json({ error: 'Could not finalize chunk upload' });
  }
});

app.delete('/api/upload/chunk/:sessionId', auth, async (req, res) => {
  const session = chunkSessions.get(String(req.params.sessionId || ''));
  if (!session || session.userId !== req.user.id) {
    return res.json({ ok: true });
  }
  await deleteChunkSession(session.id);
  return res.json({ ok: true });
});

function sanitizeZipEntryName(value, fallbackIndex) {
  const safe = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return safe || `attachment-${fallbackIndex}`;
}

function uniqueZipEntryName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let i = 2;
  while (used.has(`${base} (${i})${ext}`)) i += 1;
  const next = `${base} (${i})${ext}`;
  used.add(next);
  return next;
}

app.post('/api/attachments/zip', auth, async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    if (!incoming.length) {
      return res.status(400).json({ error: 'No attachments provided' });
    }

    const normalized = incoming
      .map((a) => normalizeAttachment(a))
      .filter(Boolean)
      .slice(0, 40);

    const usedNames = new Set();
    const localFiles = [];
    for (let i = 0; i < normalized.length; i += 1) {
      const attachment = normalized[i];
      const match = String(attachment.url || '').match(/^\/uploads\/([a-zA-Z0-9._-]+)$/);
      if (!match) continue;

      const absolutePath = path.join(uploadsDir, match[1]);
      if (!absolutePath.startsWith(uploadsDir)) continue;

      try {
        await fs.promises.access(absolutePath, fs.constants.R_OK);
      } catch {
        continue;
      }

      const safeName = sanitizeZipEntryName(attachment.name, i + 1);
      const entryName = uniqueZipEntryName(safeName, usedNames);
      localFiles.push({ absolutePath, entryName });
    }

    if (!localFiles.length) {
      return res.status(400).json({ error: 'No downloadable local attachments found' });
    }

    const archiveName = `chat-album-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Zip creation error', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Could not build zip' });
        return;
      }
      res.end();
    });

    archive.pipe(res);
    localFiles.forEach((file) => {
      archive.file(file.absolutePath, { name: file.entryName });
    });
    await archive.finalize();
  } catch (err) {
    console.error('Attachment zip error', err);
    res.status(500).json({ error: 'Could not build zip' });
  }
});

app.post('/api/attachments/report', auth, async (req, res) => {
  try {
    const messageId = String(req.body?.messageId || '').trim();
    const scope = req.body?.scope === 'private' ? 'private' : 'public';
    const attachmentUrl = String(req.body?.attachmentUrl || '').trim();
    const reason = String(req.body?.reason || 'User report').trim().slice(0, 240);
    const category = ['spam', 'harassment', 'violence', 'sexual', 'copyright', 'other'].includes(String(req.body?.category || ''))
      ? String(req.body.category)
      : 'other';
    const severity = ['low', 'medium', 'high'].includes(String(req.body?.severity || ''))
      ? String(req.body.severity)
      : 'medium';
    const note = String(req.body?.note || '').trim().slice(0, 280);

    if (!messageId || !attachmentUrl) {
      return res.status(400).json({ error: 'Missing report fields' });
    }

    await AttachmentReport.create({
      reportedById: req.user.id,
      reportedBy: req.user.username,
      messageId,
      scope,
      attachmentUrl,
      reason,
      category,
      severity,
      note,
      status: 'pending'
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Attachment report error', err);
    res.status(500).json({ error: 'Report failed' });
  }
});

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
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETED_TEXT = 'Message deleted';
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

function isEditable(ts) {
  if (!ts) return false;
  return Date.now() - new Date(ts).getTime() <= EDIT_WINDOW_MS;
}

function sanitizeReplyText(value) {
  return String(value || '').trim().slice(0, 160);
}

function messagePreviewText(message) {
  const text = sanitizeReplyText(message?.text);
  if (text) return text;

  const attachmentList = normalizeAttachments(message?.attachments, message?.attachment);
  if (attachmentList.length > 1) {
    return sanitizeReplyText(`[Attachments] ${attachmentList.length} files`);
  }
  const firstAttachment = attachmentList[0] || null;
  const attachmentName = String(firstAttachment?.name || '').trim();
  if (attachmentName) return sanitizeReplyText(`[Attachment] ${attachmentName}`);

  return '';
}

function sanitizeAudioKind(input, mimeType) {
  if (!String(mimeType || '').startsWith('audio/')) return undefined;
  const value = String(input || '').trim().toLowerCase();
  return AUDIO_KIND_VALUES.has(value) ? value : undefined;
}

function normalizeAttachment(attachment) {
  if (!attachment?.url) return null;

  const url = String(attachment.url || '').trim();
  const isLocalUpload = /^\/uploads\/[a-zA-Z0-9._-]+$/.test(url);
  const isRemoteUrl = /^https?:\/\/[^\s]+$/i.test(url);
  if (!isLocalUpload && !isRemoteUrl) return null;

  const name = String(attachment.name || '').trim().slice(0, 120);
  const mimeType = String(attachment.mimeType || 'application/octet-stream').trim().slice(0, 100);
  const size = Number(attachment.size || 0);
  const duration = Number(attachment.durationSeconds);
  const waveform = parseWaveform(attachment.waveform);
  const width = Number(attachment.width);
  const height = Number(attachment.height);
  const audioKind = sanitizeAudioKind(attachment.audioKind, mimeType);
  const storageProvider = attachment.storageProvider === 's3' ? 's3' : 'local';
  const objectKey = String(attachment.objectKey || '').trim().slice(0, 300);

  return {
    url,
    name: name || 'Attachment',
    mimeType,
    size: Number.isFinite(size) && size >= 0 ? Math.min(Math.round(size), MAX_UPLOAD_BYTES) : 0,
    isImage: mimeType.startsWith('image/'),
    durationSeconds: Number.isFinite(duration) && duration > 0
      ? Math.min(MAX_ATTACHMENT_DURATION_SECONDS, Math.max(1, Math.round(duration)))
      : undefined,
    waveform,
    audioKind,
    width: Number.isFinite(width) && width > 0
      ? Math.min(MAX_ATTACHMENT_DIMENSION, Math.max(1, Math.round(width)))
      : undefined,
    height: Number.isFinite(height) && height > 0
      ? Math.min(MAX_ATTACHMENT_DIMENSION, Math.max(1, Math.round(height)))
      : undefined,
    storageProvider,
    objectKey: objectKey || undefined
  };
}

function parseWaveform(input) {
  let list = input;
  if (typeof list === 'string') {
    const trimmed = list.trim();
    if (!trimmed) return undefined;
    try {
      list = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  if (!Array.isArray(list)) return undefined;
  const normalized = list
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x > 0)
    .slice(0, 96)
    .map((x) => Math.max(1, Math.min(32, Math.round(x))));
  return normalized.length ? normalized : undefined;
}

function normalizeAttachments(attachments, fallbackAttachment) {
  const fromArray = Array.isArray(attachments) ? attachments : [];
  const normalized = fromArray
    .map((item) => normalizeAttachment(item))
    .filter(Boolean);

  if (normalized.length) return normalized;

  const single = normalizeAttachment(fallbackAttachment);
  return single ? [single] : [];
}

function referenceAttachmentsFromMessage(message) {
  return normalizeAttachments(message?.attachments, message?.attachment);
}

function firstAttachmentFromMessage(message) {
  const list = referenceAttachmentsFromMessage(message);
  return list[0] || null;
}

async function deleteAttachmentFileIfLocal(attachment) {
  const url = String(attachment?.url || '').trim();
  const match = url.match(/^\/uploads\/([a-zA-Z0-9._-]+)$/);
  if (!match) return;

  const filePath = path.join(uploadsDir, match[1]);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error('Attachment cleanup failed', err);
    }
  }
}

function serializeReplyTo(replyTo) {
  if (!replyTo?.messageId) return null;
  const attachments = normalizeAttachments(replyTo?.attachments, replyTo?.attachment);
  return {
    messageId: replyTo.messageId.toString(),
    from: replyTo.from || '',
    text: replyTo.text || '',
    scope: replyTo.scope || 'private',
    attachment: attachments[0] || null,
    attachments
  };
}

function serializeForwardedFrom(forwardedFrom) {
  if (!forwardedFrom?.messageId) return null;
  const attachments = normalizeAttachments(forwardedFrom?.attachments, forwardedFrom?.attachment);
  return {
    messageId: forwardedFrom.messageId.toString(),
    from: forwardedFrom.from || '',
    text: forwardedFrom.text || '',
    scope: forwardedFrom.scope || 'private',
    attachment: attachments[0] || null,
    attachments
  };
}

function sanitizeAudioPlaybackPayload(payload = {}) {
  const progress = Number(payload.progress || 0);
  const currentTimeSeconds = Number(payload.currentTimeSeconds || 0);
  const durationSeconds = Number(payload.durationSeconds || 0);
  const attachmentKey = String(payload.attachmentKey || '').trim().slice(0, 180);

  if (!Number.isFinite(progress) || progress <= 0) return null;

  return {
    progress: Math.max(0, Math.min(1, progress)),
    currentTimeSeconds: Number.isFinite(currentTimeSeconds) && currentTimeSeconds >= 0 ? Math.round(currentTimeSeconds) : 0,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? Math.round(durationSeconds) : 0,
    attachmentKey: attachmentKey || undefined
  };
}

function serializeAudioPlayback(playback) {
  if (!playback || typeof playback !== 'object') return null;
  const progress = Number(playback.progress || 0);
  if (!Number.isFinite(progress) || progress <= 0) return null;

  const listenedAt = playback.listenedAt ? new Date(playback.listenedAt) : null;
  return {
    by: playback.by || '',
    progress: Math.max(0, Math.min(1, progress)),
    currentTimeSeconds: Number(playback.currentTimeSeconds || 0) || 0,
    durationSeconds: Number(playback.durationSeconds || 0) || 0,
    attachmentKey: playback.attachmentKey || undefined,
    listenedAt: listenedAt && !Number.isNaN(listenedAt.getTime()) ? listenedAt.toISOString() : null
  };
}

async function buildPublicReply(replyTo) {
  const messageId = replyTo?.messageId;
  if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) return null;

  const target = await PublicMessage.findById(messageId).lean();
  if (!target) return null;

  const attachments = referenceAttachmentsFromMessage(target);

  return {
    messageId: target._id,
    from: target.from || '',
    text: messagePreviewText(target),
    scope: 'public',
    attachment: attachments[0] || null,
    attachments
  };
}

async function buildPrivateReply(replyTo, participantIds) {
  const messageId = replyTo?.messageId;
  if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) return null;

  const target = await PrivateMessage.findById(messageId).lean();
  if (!target) return null;

  const participants = [String(target.fromId), String(target.toId)];
  const isAllowed = participantIds.every((id) => participants.includes(String(id)));
  if (!isAllowed) return null;

  const attachments = referenceAttachmentsFromMessage(target);

  return {
    messageId: target._id,
    from: target.from || '',
    text: messagePreviewText(target),
    scope: 'private',
    attachment: attachments[0] || null,
    attachments
  };
}

async function buildPublicForwarded(forwardedFrom) {
  const messageId = forwardedFrom?.messageId;
  if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) return null;

  const target = await PublicMessage.findById(messageId).lean();
  if (!target) return null;

  const attachments = referenceAttachmentsFromMessage(target);

  return {
    messageId: target._id,
    from: target.from || '',
    text: messagePreviewText(target),
    scope: 'public',
    attachment: attachments[0] || null,
    attachments
  };
}

async function buildPrivateForwarded(forwardedFrom, userId) {
  const messageId = forwardedFrom?.messageId;
  if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) return null;

  const target = await PrivateMessage.findById(messageId).lean();
  if (!target) return null;

  const participants = [String(target.fromId), String(target.toId)];
  if (!participants.includes(String(userId))) return null;

  const attachments = referenceAttachmentsFromMessage(target);

  return {
    messageId: target._id,
    from: target.from || '',
    text: messagePreviewText(target),
    scope: 'private',
    attachment: attachments[0] || null,
    attachments
  };
}

io.use((socket, next) => {
  const token = socket.handshake.query.token || socket.handshake.auth?.token;
  if (!token) return next(new Error('AUTH_REQUIRED'));
  try {
    const user = verifyAccessToken(String(token));
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
    const attachments = normalizeAttachments(data?.attachments, data?.attachment);
    if (!text && !attachments.length) return;

    try {
      const replyTo = await buildPublicReply(data?.replyTo);
      const saved = await PublicMessage.create({
        fromId: userId,
        from: username,
        text,
        attachment: attachments[0] || null,
        attachments,
        replyTo
      });

      io.emit('publicMessage', {
        id: saved._id.toString(),
        from: saved.from,
        text: saved.text,
        attachment: normalizeAttachment(saved.attachment),
        attachments: normalizeAttachments(saved.attachments, saved.attachment),
        replyTo: serializeReplyTo(saved.replyTo),
        timestamp: saved.ts.toISOString(),
        reactions: [],
        editedAt: null,
        deletedAt: null
      });
    } catch (e) {
      console.error('publicMessage error', e);
      io.emit('publicMessage', {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        from: username,
        text,
        attachment: attachments[0] || null,
        attachments,
        replyTo: null,
        timestamp: new Date().toISOString(),
        reactions: [],
        editedAt: null,
        deletedAt: null
      });
    }
  });

  // === PRIVATE CHAT with ACK + DELIVERY ===
  socket.on('privateMessage', async ({ to, text, tempId, replyTo, forwardedFrom, attachment, attachments }) => {
    try {
      stopPrivateTyping(username, to, true);
      const normalizedText = String(text || '').trim();
      const normalizedAttachments = normalizeAttachments(attachments, attachment);

      const toUser = await User.findOne({ username: to }).lean();
      const timestamp = new Date().toISOString();
      let normalizedReply = null;
      if (toUser) {
        if (replyTo?.scope === 'public') {
          normalizedReply = await buildPublicReply(replyTo);
        } else {
          normalizedReply = await buildPrivateReply(replyTo, [userId, toUser._id.toString()]);
        }
      }

      let normalizedForwarded = null;
      if (toUser) {
        if (forwardedFrom?.scope === 'public') {
          normalizedForwarded = await buildPublicForwarded(forwardedFrom);
        } else if (forwardedFrom?.scope === 'private') {
          normalizedForwarded = await buildPrivateForwarded(forwardedFrom, userId);
        }
      }

      if (!normalizedText && !normalizedAttachments.length && !normalizedForwarded?.messageId) return;

      let savedId = tempId || `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      if (toUser) {
        const saved = await PrivateMessage.create({
          fromId: userId,
          toId: toUser._id,
          from: username,
          to,
          text: normalizedText,
          attachment: normalizedAttachments[0] || null,
          attachments: normalizedAttachments,
          replyTo: normalizedReply,
          forwardedFrom: normalizedForwarded,
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
          id: savedId,
          from: username,
          to,
          text: normalizedText,
          attachment: normalizedAttachments[0] || null,
          attachments: normalizedAttachments,
          replyTo: serializeReplyTo(normalizedReply),
          forwardedFrom: serializeForwardedFrom(normalizedForwarded),
          audioPlayback: null,
          timestamp,
          reactions: [],
          editedAt: null,
          deletedAt: null
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

  socket.on('audioPlaybackProgress', async ({ id, progress, currentTimeSeconds, durationSeconds, attachmentKey }) => {
    try {
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return;
      const sanitized = sanitizeAudioPlaybackPayload({ progress, currentTimeSeconds, durationSeconds, attachmentKey });
      if (!sanitized) return;

      const message = await PrivateMessage.findById(id);
      if (!message || message.deletedAt) return;

      const participants = [String(message.fromId), String(message.toId)];
      if (!participants.includes(String(userId))) return;

      // Audio read receipt only tracks receiver playback on sender's message.
      if (String(message.toId) !== String(userId)) return;

      const previous = Number(message.audioPlayback?.progress || 0);
      const isMeaningfulAdvance = sanitized.progress >= 0.98 || sanitized.progress >= previous + 0.02;
      if (!isMeaningfulAdvance) return;

      const listenedAt = new Date();
      message.audioPlayback = {
        by: username,
        progress: sanitized.progress,
        currentTimeSeconds: sanitized.currentTimeSeconds,
        durationSeconds: sanitized.durationSeconds,
        attachmentKey: sanitized.attachmentKey,
        listenedAt
      };
      await message.save();

      const payload = {
        id: message._id.toString(),
        by: username,
        progress: sanitized.progress,
        currentTimeSeconds: sanitized.currentTimeSeconds,
        durationSeconds: sanitized.durationSeconds,
        attachmentKey: sanitized.attachmentKey,
        listenedAt: listenedAt.toISOString()
      };

      io.to(`user:${message.fromId}`).emit('privateAudioPlayback', payload);
      io.to(`user:${message.toId}`).emit('privateAudioPlayback', payload);
    } catch (e) {
      console.error('audioPlaybackProgress error', e);
    }
  });

  socket.on('messageReaction', async ({ scope, messageId, emoji }) => {
    try {
      if (!messageId || !emoji || !ALLOWED_REACTIONS.has(emoji)) return;

      if (scope === 'public') {
        const message = await PublicMessage.findById(messageId);
        if (!message || message.deletedAt) return;

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
        if (!message || message.deletedAt) return;

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

  socket.on('editMessage', async ({ scope, messageId, text }) => {
    try {
      const nextText = (text || '').trim();
      if (!messageId || !nextText) return;

      if (scope === 'public') {
        const message = await PublicMessage.findById(messageId);
        if (!message) return;

        if (String(message.fromId) !== String(userId)) return;
        if (message.deletedAt || !isEditable(message.ts)) return;

        message.text = nextText;
        message.editedAt = new Date();
        await message.save();

        io.emit('messageEdited', {
          scope: 'public',
          messageId,
          text: message.text,
          editedAt: message.editedAt.toISOString()
        });
        return;
      }

      if (scope === 'private') {
        const message = await PrivateMessage.findById(messageId);
        if (!message) return;

        if (String(message.fromId) !== String(userId)) return;
        if (message.deletedAt || !isEditable(message.ts)) return;

        message.text = nextText;
        message.editedAt = new Date();
        await message.save();

        const payload = {
          scope: 'private',
          messageId,
          text: message.text,
          editedAt: message.editedAt.toISOString()
        };

        io.to(`user:${message.fromId}`).emit('messageEdited', payload);
        io.to(`user:${message.toId}`).emit('messageEdited', payload);
      }
    } catch (e) {
      console.error('editMessage error', e);
    }
  });

  socket.on('deleteMessage', async ({ scope, messageId }) => {
    try {
      if (!messageId) return;

      if (scope === 'public') {
        const message = await PublicMessage.findById(messageId);
        if (!message) return;

        if (String(message.fromId) !== String(userId)) return;
        if (message.deletedAt) return;

        const attachmentsToDelete = normalizeAttachments(message.attachments, message.attachment);
        for (const item of attachmentsToDelete) {
          await deleteAttachmentFileIfLocal(item);
        }
        message.text = DELETED_TEXT;
        message.attachment = null;
        message.attachments = [];
        message.deletedAt = new Date();
        message.reactions = [];
        await message.save();

        io.emit('messageDeleted', {
          scope: 'public',
          messageId,
          deletedAt: message.deletedAt.toISOString()
        });
        return;
      }

      if (scope === 'private') {
        const message = await PrivateMessage.findById(messageId);
        if (!message) return;

        if (String(message.fromId) !== String(userId)) return;
        if (message.deletedAt) return;

        const attachmentsToDelete = normalizeAttachments(message.attachments, message.attachment);
        for (const item of attachmentsToDelete) {
          await deleteAttachmentFileIfLocal(item);
        }
        message.text = DELETED_TEXT;
        message.attachment = null;
        message.attachments = [];
        message.deletedAt = new Date();
        message.reactions = [];
        await message.save();

        const payload = {
          scope: 'private',
          messageId,
          deletedAt: message.deletedAt.toISOString()
        };

        io.to(`user:${message.fromId}`).emit('messageDeleted', payload);
        io.to(`user:${message.toId}`).emit('messageDeleted', payload);
      }
    } catch (e) {
      console.error('deleteMessage error', e);
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

app.use((err, req, res, next) => {
  if (!err) return next();
  const requestId = req.requestId || crypto.randomUUID();
  if (String(err.message || '').includes('CORS_NOT_ALLOWED')) {
    return res.status(403).json({
      error: {
        code: 'CORS_FORBIDDEN',
        message: 'Request origin is not allowed.',
        requestId
      }
    });
  }

  console.error('Unhandled server error', { requestId, message: err.message });
  return res.status(500).json({
    error: {
      code: 'SERVER_ERROR',
      message: 'Unexpected server error.',
      requestId
    }
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
