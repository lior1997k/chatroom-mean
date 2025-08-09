const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');

const router = express.Router();

// ---------------------------------------------------------
// Ensure upload directory exists
// ---------------------------------------------------------
const VOICE_DIR = path.join(__dirname, '..', 'uploads', 'voice');
fs.mkdirSync(VOICE_DIR, { recursive: true });

// ---------------------------------------------------------
// Helper to guess file extension from MIME type
// ---------------------------------------------------------
function guessExt(mime) {
  if (!mime) return '.webm';
  if (mime.includes('ogg'))  return '.ogg';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('mp4'))  return '.m4a';
  if (mime.includes('wav'))  return '.wav';
  if (mime.includes('webm')) return '.webm';
  return '.webm';
}

// ---------------------------------------------------------
// Configure Multer storage engine
// ---------------------------------------------------------
// Files are saved to VOICE_DIR with a name like:
// v_<timestamp>_<random>.<ext>
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, VOICE_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname) || guessExt(file.mimetype) || '.webm';
    const name = `v_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});

// ---------------------------------------------------------
// Create Multer instance with size/type limits
// ---------------------------------------------------------
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (_, file, cb) => {
    // Only allow certain audio formats
    if (/^audio\/(webm|ogg|mpeg|mp4|wav)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported audio type'));
  }
});

// ---------------------------------------------------------
// JWT authentication middleware
// ---------------------------------------------------------
function auth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token' });
    const user = jwt.verify(token, process.env.JWT_SECRET);
    req.user = user; // Attach decoded user info (id, username) to request
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ---------------------------------------------------------
// POST /api/upload/voice endpoint
// ---------------------------------------------------------
/**
 * Expected FormData:
 *   voice: (file) The recorded audio
 *   durationMs: (number, optional) Length of audio in milliseconds
 * 
 * Returns:
 *   { url, durationMs }
 */
router.post('/voice', auth, upload.single('voice'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });

  const durationMs = Number(req.body.durationMs || 0);

  // Build public URL to serve the file
  const base = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
  const url  = `${base}/static/voice/${file.filename}`;

  res.json({ url, durationMs });
});

module.exports = router;
