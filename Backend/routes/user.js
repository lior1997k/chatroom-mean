const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AuthAbuseEvent = require('../models/AuthAbuseEvent');
const { signAccessToken, refreshTokenExpiresAt, refreshTokenTtlMs } = require('../utils/jwt');
const auth = require('../middleware/auth');

const router = express.Router();

const INVALID_CREDENTIALS_MESSAGE = 'Invalid username/email or password';
const USERNAME_REGEX = /^[a-z0-9_]{3,24}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const LOGIN_MAX_ATTEMPTS_BEFORE_LOCK = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const REGISTER_RATE_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_RATE_MAX = 8;
const LOGIN_RATE_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_RATE_MAX = 12;
const SOCIAL_RATE_WINDOW_MS = 10 * 60 * 1000;
const SOCIAL_RATE_MAX = 18;
const EMAIL_VERIFY_RATE_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_VERIFY_RATE_MAX = 10;
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_RESEND_MIN_INTERVAL_MS = 45 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_RESEND_MIN_INTERVAL_MS = 45 * 1000;
const rateLimitState = new Map();
const RATE_LIMIT_BACKOFF_MS = 2 * 60 * 1000;

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const APPLE_CLIENT_ID = String(process.env.APPLE_CLIENT_ID || '').trim();
const CLIENT_URL = String(process.env.CLIENT_URL || 'http://localhost:4200').trim();
const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true' || SMTP_PORT === 465;
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '').trim();
const MAIL_FROM = String(process.env.MAIL_FROM || SMTP_USER || 'no-reply@chatroom.local').trim();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
let mailTransport = null;
const NONCE_REGEX = /^[A-Za-z0-9_-]{20,256}$/;

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  return EMAIL_REGEX.test(String(value || '').trim().toLowerCase());
}

function passwordPolicyIssues(passwordRaw) {
  const password = String(passwordRaw || '');
  const issues = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[A-Z]/.test(password)) issues.push('an uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('a lowercase letter');
  if (!/[0-9]/.test(password)) issues.push('a number');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('a symbol');
  return issues;
}

function enforceRateLimit(req, res, scope, windowMs, maxHits, suffix = '') {
  const now = Date.now();
  const ip = String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
  const safeSuffix = String(suffix || '').trim().slice(0, 80).toLowerCase();
  const key = `${scope}:${ip}:${safeSuffix}`;
  const current = rateLimitState.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitState.set(key, { count: 1, resetAt: now + windowMs, lockUntil: 0 });
    return true;
  }

  if (Number(current.lockUntil || 0) > now) {
    const waitSeconds = Math.max(1, Math.ceil((current.lockUntil - now) / 1000));
    res.setHeader('Retry-After', String(waitSeconds));
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many attempts. Try again in ${waitSeconds}s.`
      }
    });
    return false;
  }

  if (current.count >= maxHits) {
    current.lockUntil = Math.max(current.resetAt, now + RATE_LIMIT_BACKOFF_MS);
    rateLimitState.set(key, current);
    const waitSeconds = Math.max(1, Math.ceil((current.lockUntil - now) / 1000));
    res.setHeader('Retry-After', String(waitSeconds));
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many attempts. Try again in ${waitSeconds}s.`
      }
    });
    return false;
  }

  current.count += 1;
  rateLimitState.set(key, current);
  return true;
}

function maybeCleanupRateLimitMap() {
  if (rateLimitState.size < 200) return;
  const now = Date.now();
  for (const [key, entry] of rateLimitState.entries()) {
    if (!entry || Number(entry.resetAt || 0) <= now) rateLimitState.delete(key);
  }
}

function recordAbuseEvent(type, req, identifier = '', details = null, severity = 1) {
  const ip = String(req.ip || req.headers['x-forwarded-for'] || '').slice(0, 120);
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase().slice(0, 120);
  void AuthAbuseEvent.create({
    type,
    ip,
    identifier: normalizedIdentifier,
    details,
    severity: Number.isFinite(Number(severity)) ? Number(severity) : 1
  }).catch(() => {
    // no-op
  });
}

function getMailTransport() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  if (mailTransport) return mailTransport;
  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
  return mailTransport;
}

function hashVerificationToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function isValidClientNonce(value) {
  return NONCE_REGEX.test(String(value || '').trim());
}

function nonceMatches(expectedNonce, tokenNonce) {
  const expected = String(expectedNonce || '').trim();
  const provided = String(tokenNonce || '').trim();
  if (!expected || !provided) return false;
  if (provided === expected) return true;
  return provided === sha256Hex(expected);
}

function createRefreshTokenRaw() {
  return crypto.randomBytes(48).toString('hex');
}

function hashRefreshToken(rawToken) {
  return hashVerificationToken(rawToken);
}

function clientIp(req) {
  return String(req.ip || req.headers['x-forwarded-for'] || '').slice(0, 120);
}

async function issueSessionTokens(user, req, options = {}) {
  const rawRefreshToken = createRefreshTokenRaw();
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  const tokenFamily = String(options.tokenFamily || crypto.randomUUID());
  const session = await AuthSession.create({
    userId: user._id,
    refreshTokenHash,
    tokenFamily,
    expiresAt: refreshTokenExpiresAt(),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    ip: clientIp(req)
  });

  if (options.replacesSessionId) {
    await AuthSession.updateOne(
      { _id: options.replacesSessionId, userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date(), replacedBySessionId: session._id } }
    );
  }

  const token = signAccessToken({
    id: user._id,
    username: user.username,
    sid: session._id.toString()
  });

  return {
    token,
    refreshToken: rawRefreshToken,
    refreshTokenExpiresInMs: refreshTokenTtlMs()
  };
}

function createEmailVerificationToken() {
  const raw = crypto.randomBytes(24).toString('hex');
  return {
    raw,
    hash: hashVerificationToken(raw),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS)
  };
}

function createPasswordResetToken() {
  const raw = crypto.randomBytes(24).toString('hex');
  return {
    raw,
    hash: hashVerificationToken(raw),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS)
  };
}

function buildEmailVerificationLink(email, token) {
  const base = String(process.env.API_URL || '').trim();
  if (base) {
    return `${base.replace(/\/$/, '')}/api/user/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  }
  const fallbackBase = String(process.env.SERVER_URL || 'http://localhost:3000').trim();
  return `${fallbackBase.replace(/\/$/, '')}/api/user/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail(user, rawToken) {
  const email = normalizeEmail(user?.email);
  if (!email || !rawToken) return { sent: false, reason: 'invalid-payload' };
  const link = buildEmailVerificationLink(email, rawToken);

  const transporter = getMailTransport();
  if (!transporter) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Email verification link for ${email}: ${link}`);
    }
    return { sent: false, reason: 'smtp-not-configured' };
  }

  await transporter.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: 'Verify your ChatRoom email',
    text: `Hi ${user.username},\n\nVerify your email by opening this link:\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi <b>${user.username}</b>,</p><p>Verify your email by clicking this link:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`
  });

  return { sent: true };
}

function buildPasswordResetLink(email, token) {
  const clientUrl = CLIENT_URL.replace(/\/$/, '');
  return `${clientUrl}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

async function sendPasswordResetEmail(user, rawToken) {
  const email = normalizeEmail(user?.email);
  if (!email || !rawToken) return { sent: false, reason: 'invalid-payload' };
  const link = buildPasswordResetLink(email, rawToken);

  const transporter = getMailTransport();
  if (!transporter) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Password reset link for ${email}: ${link}`);
    }
    return { sent: false, reason: 'smtp-not-configured' };
  }

  await transporter.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: 'Reset your ChatRoom password',
    text: `Hi ${user.username},\n\nReset your password with this link:\n${link}\n\nThis link expires in 1 hour.`,
    html: `<p>Hi <b>${user.username}</b>,</p><p>Reset your password with this link:</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour.</p>`
  });

  return { sent: true };
}

function safeUserResponse(user) {
  return {
    _id: user._id,
    username: user.username,
    email: user.email || null,
    avatarUrl: user.avatarUrl
  };
}

function socialProfileSetupResponse(provider, profile) {
  return {
    error: {
      code: 'PROFILE_SETUP_REQUIRED',
      message: `Choose a username to finish ${provider} sign in.`
    },
    profile
  };
}

function suggestedUsernameFromProfile(profile) {
  const emailPrefix = String(profile.email || '').split('@')[0];
  const name = String(profile.name || '').trim();
  const raw = emailPrefix || name || 'user';
  const normalized = raw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return (normalized || 'user').slice(0, 24);
}

async function verifyGoogleIdToken(idToken, expectedNonce) {
  if (!GOOGLE_CLIENT_ID || !googleClient) {
    throw new Error('GOOGLE_NOT_CONFIGURED');
  }

  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error('GOOGLE_TOKEN_INVALID');
  if (!nonceMatches(expectedNonce, payload.nonce)) throw new Error('GOOGLE_NONCE_INVALID');

  return {
    provider: 'google',
    sub: String(payload.sub),
    email: normalizeEmail(payload.email || ''),
    emailVerified: !!payload.email_verified,
    name: String(payload.name || '').trim()
  };
}

async function verifyAppleIdToken(idToken, expectedNonce) {
  if (!APPLE_CLIENT_ID) {
    throw new Error('APPLE_NOT_CONFIGURED');
  }

  const payload = await appleSignin.verifyIdToken(idToken, {
    audience: APPLE_CLIENT_ID,
    ignoreExpiration: false
  });
  if (!payload?.sub) throw new Error('APPLE_TOKEN_INVALID');
  if (!nonceMatches(expectedNonce, payload.nonce)) throw new Error('APPLE_NONCE_INVALID');

  return {
    provider: 'apple',
    sub: String(payload.sub),
    email: normalizeEmail(payload.email || ''),
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: ''
  };
}

async function findOrCreateSocialUser(profile, requestedUsernameRaw, req) {
  const providerSubField = profile.provider === 'google' ? 'googleSub' : 'appleSub';
  const providerSub = String(profile.sub || '').trim();
  if (!providerSub) {
    return {
      status: 401,
      body: { error: { code: 'SOCIAL_TOKEN_INVALID', message: 'Invalid social token.' } }
    };
  }

  let user = await User.findOne({ [providerSubField]: providerSub });

  // If account exists by verified email, link provider.
  if (!user && profile.email && profile.emailVerified) {
    user = await User.findOne({ email: profile.email });
    if (user && !user[providerSubField]) {
      user[providerSubField] = providerSub;
      await user.save();
    }
  }

  if (!user) {
    const requestedUsername = normalizeUsername(requestedUsernameRaw);
    if (!requestedUsername) {
      return {
        status: 409,
        body: socialProfileSetupResponse(profile.provider, {
          provider: profile.provider,
          email: profile.email || '',
          suggestedUsername: suggestedUsernameFromProfile(profile),
          name: profile.name || ''
        })
      };
    }

    if (!USERNAME_REGEX.test(requestedUsername)) {
      return {
        status: 400,
        body: {
          error: {
            code: 'INVALID_USERNAME',
            message: 'Username must be 3-24 chars using lowercase letters, numbers, or underscores.'
          }
        }
      };
    }

    const usernameTaken = await User.findOne({ username: requestedUsername }).lean();
    if (usernameTaken) {
      return {
        status: 409,
        body: {
          error: {
            code: 'USERNAME_TAKEN',
            message: 'Username already exists.'
          }
        }
      };
    }

    if (profile.email) {
      const emailTaken = await User.findOne({ email: profile.email }).lean();
      if (emailTaken) {
        return {
          status: 409,
          body: {
            error: {
              code: 'EMAIL_TAKEN',
              message: 'Email is already used by another account.'
            }
          }
        };
      }
    }

    user = await User.create({
      username: requestedUsername,
      email: profile.email || undefined,
      password: null,
      googleSub: profile.provider === 'google' ? providerSub : null,
      appleSub: profile.provider === 'apple' ? providerSub : null,
      emailVerified: !!(profile.email && profile.emailVerified),
      loginFailures: 0,
      lockUntil: null,
      lastLoginAt: new Date()
    });
  }

  user.loginFailures = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();
  if (profile.provider === 'google' && !user.googleSub) user.googleSub = providerSub;
  if (profile.provider === 'apple' && !user.appleSub) user.appleSub = providerSub;
  if (!user.email && profile.email && profile.emailVerified) user.email = profile.email;
  if (profile.email && profile.emailVerified) user.emailVerified = true;
  await user.save();

  const sessionTokens = await issueSessionTokens(user, req);
  return {
    status: 200,
    body: {
      message: `${profile.provider} login successful`,
      token: sessionTokens.token,
      refreshToken: sessionTokens.refreshToken,
      refreshTokenExpiresInMs: sessionTokens.refreshTokenExpiresInMs,
      user: safeUserResponse(user)
    }
  };
}

router.post('/register', async (req, res) => {
  maybeCleanupRateLimitMap();
  const registerEmail = normalizeEmail(req.body?.email);
  if (!enforceRateLimit(req, res, 'register', REGISTER_RATE_WINDOW_MS, REGISTER_RATE_MAX, registerEmail)) {
    recordAbuseEvent('register-rate-limited', req, registerEmail);
    return;
  }

  try {
    const username = normalizeUsername(req.body?.username);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!username || !email || !password) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Username, email, and password are required.'
        }
      });
    }

    if (!USERNAME_REGEX.test(username)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_USERNAME',
          message: 'Username must be 3-24 chars using lowercase letters, numbers, or underscores.'
        }
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_EMAIL',
          message: 'Email address is invalid.'
        }
      });
    }

    const passwordIssues = passwordPolicyIssues(password);
    if (passwordIssues.length) {
      return res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: `Password must include ${passwordIssues.join(', ')}.`
        }
      });
    }

    const [usernameExists, emailExists] = await Promise.all([
      User.findOne({ username }).lean(),
      User.findOne({ email }).lean()
    ]);
    if (usernameExists) {
      return res.status(409).json({
        error: {
          code: 'USERNAME_TAKEN',
          message: 'Username already exists.'
        }
      });
    }
    if (emailExists) {
      return res.status(409).json({
        error: {
          code: 'EMAIL_TAKEN',
          message: 'Email already exists.'
        }
      });
    }

    const hashed = await bcrypt.hash(password, 12);
    const verification = createEmailVerificationToken();
    const user = await User.create({
      username,
      email,
      password: hashed,
      emailVerified: false,
      emailVerificationTokenHash: verification.hash,
      emailVerificationExpiresAt: verification.expiresAt,
      emailVerificationRequestedAt: new Date(),
      passwordChangedAt: new Date(),
      loginFailures: 0,
      lockUntil: null
    });

    let emailDelivery = 'sent';
    try {
      const sent = await sendVerificationEmail(user, verification.raw);
      if (!sent?.sent) emailDelivery = sent?.reason || 'not-sent';
    } catch (mailErr) {
      console.error('register verification email error', mailErr);
      emailDelivery = 'failed';
    }

    res.status(201).json({
      message: 'User registered. Verify your email before logging in.',
      verificationRequired: true,
      emailDelivery,
      user: safeUserResponse(user)
    });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({
      error: {
        code: 'REGISTER_FAILED',
        message: 'Registration failed. Please try again.'
      }
    });
  }
});

router.post('/login', async (req, res) => {
  maybeCleanupRateLimitMap();
  const loginIdentifier = normalizeIdentifier(req.body?.identifier || req.body?.username);
  if (!enforceRateLimit(req, res, 'login', LOGIN_RATE_WINDOW_MS, LOGIN_RATE_MAX, loginIdentifier)) {
    recordAbuseEvent('login-rate-limited', req, loginIdentifier);
    return;
  }

  try {
    const identifier = normalizeIdentifier(req.body?.identifier || req.body?.username);
    const password = String(req.body?.password || '');
    if (!identifier || !password) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Username/email and password are required.'
        }
      });
    }

    const query = isEmail(identifier)
      ? { email: normalizeEmail(identifier) }
      : { username: normalizeUsername(identifier) };
    const user = await User.findOne(query);
    if (!user) {
      recordAbuseEvent('login-invalid-user', req, identifier);
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: INVALID_CREDENTIALS_MESSAGE
        }
      });
    }

    if (!user.password) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_LOGIN_DISABLED',
          message: 'This account uses social sign-in. Use Google or Apple.'
        }
      });
    }

    if (user.email && !user.emailVerified) {
      return res.status(403).json({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Verify your email before signing in.'
        }
      });
    }

    const now = Date.now();
    const lockUntilMs = Number(new Date(user.lockUntil || 0).getTime() || 0);
    if (lockUntilMs > now) {
      const waitSeconds = Math.max(1, Math.ceil((lockUntilMs - now) / 1000));
      return res.status(423).json({
        error: {
          code: 'ACCOUNT_LOCKED',
          message: `Too many failed attempts. Try again in ${waitSeconds}s.`
        }
      });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      recordAbuseEvent('login-invalid-password', req, identifier, { userId: user._id }, 2);
      const failedCount = Math.max(0, Number(user.loginFailures || 0)) + 1;
      const shouldLock = failedCount >= LOGIN_MAX_ATTEMPTS_BEFORE_LOCK;
      user.loginFailures = shouldLock ? 0 : failedCount;
      user.lockUntil = shouldLock ? new Date(now + LOGIN_LOCK_MS) : null;
      await user.save();

      return res.status(401).json({
        error: {
          code: shouldLock ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
          message: shouldLock
            ? `Too many failed attempts. Try again in ${Math.ceil(LOGIN_LOCK_MS / 1000)}s.`
            : INVALID_CREDENTIALS_MESSAGE
        }
      });
    }

    user.loginFailures = 0;
    user.lockUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    const sessionTokens = await issueSessionTokens(user, req);
    res.json({
      message: 'Login successful',
      token: sessionTokens.token,
      refreshToken: sessionTokens.refreshToken,
      refreshTokenExpiresInMs: sessionTokens.refreshTokenExpiresInMs,
      user: safeUserResponse(user)
    });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({
      error: {
        code: 'LOGIN_FAILED',
        message: 'Login failed. Please try again.'
      }
    });
  }
});

router.post('/refresh-token', async (req, res) => {
  try {
    const rawRefreshToken = String(req.body?.refreshToken || '').trim();
    if (!rawRefreshToken) {
      return res.status(400).json({
        error: {
          code: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token is required.'
        }
      });
    }

    const refreshTokenHash = hashRefreshToken(rawRefreshToken);
    const session = await AuthSession.findOne({ refreshTokenHash });
    if (!session || session.revokedAt || Number(new Date(session.expiresAt || 0).getTime() || 0) <= Date.now()) {
      recordAbuseEvent('refresh-invalid-token', req, '', null, 2);
      return res.status(401).json({
        error: {
          code: 'REFRESH_TOKEN_INVALID',
          message: 'Refresh token is invalid or expired.'
        }
      });
    }

    const user = await User.findById(session.userId);
    if (!user) {
      return res.status(401).json({
        error: {
          code: 'REFRESH_TOKEN_INVALID',
          message: 'Refresh token is invalid or expired.'
        }
      });
    }

    session.lastUsedAt = new Date();
    await session.save();

    const nextTokens = await issueSessionTokens(user, req, {
      tokenFamily: session.tokenFamily,
      replacesSessionId: session._id
    });

    return res.json({
      message: 'Token refreshed',
      token: nextTokens.token,
      refreshToken: nextTokens.refreshToken,
      refreshTokenExpiresInMs: nextTokens.refreshTokenExpiresInMs,
      user: safeUserResponse(user)
    });
  } catch (err) {
    console.error('refresh-token error', err);
    return res.status(500).json({
      error: {
        code: 'REFRESH_TOKEN_FAILED',
        message: 'Could not refresh session.'
      }
    });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const rawRefreshToken = String(req.body?.refreshToken || '').trim();
    if (rawRefreshToken) {
      const refreshTokenHash = hashRefreshToken(rawRefreshToken);
      await AuthSession.updateOne(
        { refreshTokenHash, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
    return res.json({ message: 'Logged out.' });
  } catch (err) {
    console.error('logout error', err);
    return res.status(500).json({
      error: {
        code: 'LOGOUT_FAILED',
        message: 'Could not logout.'
      }
    });
  }
});

router.post('/logout-all', auth, async (req, res) => {
  try {
    await AuthSession.updateMany(
      { userId: req.user.id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return res.json({ message: 'Logged out from all devices.' });
  } catch (err) {
    console.error('logout-all error', err);
    return res.status(500).json({
      error: {
        code: 'LOGOUT_ALL_FAILED',
        message: 'Could not logout all sessions.'
      }
    });
  }
});

router.get('/sessions', auth, async (req, res) => {
  try {
    const sessions = await AuthSession.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.json(sessions.map((session) => ({
      id: session._id.toString(),
      tokenFamily: session.tokenFamily,
      userAgent: session.userAgent || '',
      ip: session.ip || '',
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt
    })));
  } catch (err) {
    console.error('sessions error', err);
    return res.status(500).json({
      error: {
        code: 'SESSIONS_FETCH_FAILED',
        message: 'Could not load sessions.'
      }
    });
  }
});

router.post('/verify-email/resend', async (req, res) => {
  maybeCleanupRateLimitMap();
  const verifyEmail = normalizeEmail(req.body?.email);
  if (!enforceRateLimit(req, res, 'verify-email-resend', EMAIL_VERIFY_RATE_WINDOW_MS, EMAIL_VERIFY_RATE_MAX, verifyEmail)) {
    recordAbuseEvent('verify-email-rate-limited', req, verifyEmail);
    return;
  }

  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_EMAIL',
          message: 'Email address is invalid.'
        }
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({
        message: 'If this email exists, a verification message was sent.'
      });
    }

    if (user.emailVerified) {
      return res.json({
        message: 'Email is already verified.'
      });
    }

    const lastRequestedAt = Number(new Date(user.emailVerificationRequestedAt || 0).getTime() || 0);
    if (lastRequestedAt && Date.now() - lastRequestedAt < EMAIL_RESEND_MIN_INTERVAL_MS) {
      const waitSeconds = Math.max(1, Math.ceil((EMAIL_RESEND_MIN_INTERVAL_MS - (Date.now() - lastRequestedAt)) / 1000));
      return res.status(429).json({
        error: {
          code: 'VERIFY_EMAIL_WAIT',
          message: `Please wait ${waitSeconds}s before requesting another email.`
        }
      });
    }

    const verification = createEmailVerificationToken();
    user.emailVerificationTokenHash = verification.hash;
    user.emailVerificationExpiresAt = verification.expiresAt;
    user.emailVerificationRequestedAt = new Date();
    await user.save();

    try {
      await sendVerificationEmail(user, verification.raw);
    } catch (err) {
      console.error('verify-email/resend mail error', err);
    }

    return res.json({
      message: 'If this email exists, a verification message was sent.'
    });
  } catch (err) {
    console.error('verify-email/resend error', err);
    return res.status(500).json({
      error: {
        code: 'VERIFY_EMAIL_RESEND_FAILED',
        message: 'Could not resend verification email.'
      }
    });
  }
});

router.post('/verify-email/confirm', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.token || '').trim();
    if (!email || !token) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Email and token are required.'
        }
      });
    }

    const tokenHash = hashVerificationToken(token);
    const user = await User.findOne({
      email,
      emailVerified: false,
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        error: {
          code: 'VERIFY_EMAIL_INVALID',
          message: 'Verification link is invalid or expired.'
        }
      });
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    user.emailVerificationRequestedAt = null;
    await user.save();

    return res.json({ message: 'Email verified successfully.' });
  } catch (err) {
    console.error('verify-email/confirm error', err);
    return res.status(500).json({
      error: {
        code: 'VERIFY_EMAIL_CONFIRM_FAILED',
        message: 'Could not verify email.'
      }
    });
  }
});

router.get('/verify-email', async (req, res) => {
  try {
    const email = normalizeEmail(req.query?.email);
    const token = String(req.query?.token || '').trim();
    if (!email || !token) {
      return res.redirect(`${CLIENT_URL.replace(/\/$/, '')}/login?reason=email-verify-failed`);
    }

    const tokenHash = hashVerificationToken(token);
    const user = await User.findOne({
      email,
      emailVerified: false,
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() }
    });

    if (!user) {
      return res.redirect(`${CLIENT_URL.replace(/\/$/, '')}/login?reason=email-verify-failed`);
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    user.emailVerificationRequestedAt = null;
    await user.save();

    return res.redirect(`${CLIENT_URL.replace(/\/$/, '')}/login?reason=email-verified`);
  } catch (err) {
    console.error('verify-email redirect error', err);
    return res.redirect(`${CLIENT_URL.replace(/\/$/, '')}/login?reason=email-verify-failed`);
  }
});

router.post('/social/google', async (req, res) => {
  maybeCleanupRateLimitMap();
  if (!enforceRateLimit(req, res, 'social-google', SOCIAL_RATE_WINDOW_MS, SOCIAL_RATE_MAX)) {
    recordAbuseEvent('social-google-rate-limited', req);
    return;
  }

  try {
    const idToken = String(req.body?.idToken || '').trim();
    const username = String(req.body?.username || '');
    const nonce = String(req.body?.nonce || '').trim();
    if (!idToken) {
      return res.status(400).json({
        error: {
          code: 'MISSING_TOKEN',
          message: 'Google token is required.'
        }
      });
    }
    if (!isValidClientNonce(nonce)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_NONCE',
          message: 'OAuth nonce is missing or invalid.'
        }
      });
    }

    const profile = await verifyGoogleIdToken(idToken, nonce);
    const result = await findOrCreateSocialUser(profile, username, req);
    res.status(result.status).json(result.body);
  } catch (err) {
    const message = err?.message || '';
    if (message === 'GOOGLE_NOT_CONFIGURED') {
      return res.status(503).json({
        error: {
          code: 'SOCIAL_NOT_CONFIGURED',
          message: 'Google sign-in is not configured on server.'
        }
      });
    }
    if (message === 'GOOGLE_NONCE_INVALID') {
      return res.status(401).json({
        error: {
          code: 'SOCIAL_NONCE_INVALID',
          message: 'Google sign-in nonce validation failed.'
        }
      });
    }

    console.error('social google error', err);
    res.status(401).json({
      error: {
        code: 'SOCIAL_TOKEN_INVALID',
        message: 'Google sign-in failed. Try again.'
      }
    });
  }
});

router.post('/social/apple', async (req, res) => {
  maybeCleanupRateLimitMap();
  if (!enforceRateLimit(req, res, 'social-apple', SOCIAL_RATE_WINDOW_MS, SOCIAL_RATE_MAX)) {
    recordAbuseEvent('social-apple-rate-limited', req);
    return;
  }

  try {
    const idToken = String(req.body?.idToken || '').trim();
    const username = String(req.body?.username || '');
    const nonce = String(req.body?.nonce || '').trim();
    if (!idToken) {
      return res.status(400).json({
        error: {
          code: 'MISSING_TOKEN',
          message: 'Apple token is required.'
        }
      });
    }
    if (!isValidClientNonce(nonce)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_NONCE',
          message: 'OAuth nonce is missing or invalid.'
        }
      });
    }

    const profile = await verifyAppleIdToken(idToken, nonce);
    const result = await findOrCreateSocialUser(profile, username, req);
    res.status(result.status).json(result.body);
  } catch (err) {
    const message = err?.message || '';
    if (message === 'APPLE_NOT_CONFIGURED') {
      return res.status(503).json({
        error: {
          code: 'SOCIAL_NOT_CONFIGURED',
          message: 'Apple sign-in is not configured on server.'
        }
      });
    }
    if (message === 'APPLE_NONCE_INVALID') {
      return res.status(401).json({
        error: {
          code: 'SOCIAL_NONCE_INVALID',
          message: 'Apple sign-in nonce validation failed.'
        }
      });
    }

    console.error('social apple error', err);
    res.status(401).json({
      error: {
        code: 'SOCIAL_TOKEN_INVALID',
        message: 'Apple sign-in failed. Try again.'
      }
    });
  }
});

router.post('/password/forgot', async (req, res) => {
  maybeCleanupRateLimitMap();
  const forgotEmail = normalizeEmail(req.body?.email);
  if (!enforceRateLimit(req, res, 'password-forgot', EMAIL_VERIFY_RATE_WINDOW_MS, EMAIL_VERIFY_RATE_MAX, forgotEmail)) {
    recordAbuseEvent('password-forgot-rate-limited', req, forgotEmail);
    return;
  }

  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_EMAIL',
          message: 'Email address is invalid.'
        }
      });
    }

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.json({ message: 'If this email exists, a reset link was sent.' });
    }

    const lastRequestedAt = Number(new Date(user.passwordResetRequestedAt || 0).getTime() || 0);
    if (lastRequestedAt && Date.now() - lastRequestedAt < PASSWORD_RESET_RESEND_MIN_INTERVAL_MS) {
      const waitSeconds = Math.max(1, Math.ceil((PASSWORD_RESET_RESEND_MIN_INTERVAL_MS - (Date.now() - lastRequestedAt)) / 1000));
      return res.status(429).json({
        error: {
          code: 'PASSWORD_RESET_WAIT',
          message: `Please wait ${waitSeconds}s before requesting another reset email.`
        }
      });
    }

    const reset = createPasswordResetToken();
    user.passwordResetTokenHash = reset.hash;
    user.passwordResetExpiresAt = reset.expiresAt;
    user.passwordResetRequestedAt = new Date();
    await user.save();

    try {
      await sendPasswordResetEmail(user, reset.raw);
    } catch (mailErr) {
      console.error('password/forgot mail error', mailErr);
    }

    return res.json({ message: 'If this email exists, a reset link was sent.' });
  } catch (err) {
    console.error('password/forgot error', err);
    return res.status(500).json({
      error: {
        code: 'PASSWORD_FORGOT_FAILED',
        message: 'Could not process forgot password request.'
      }
    });
  }
});

router.post('/password/reset', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!email || !token || !password) {
      return res.status(400).json({
        error: {
          code: 'MISSING_FIELDS',
          message: 'Email, token, and new password are required.'
        }
      });
    }

    const passwordIssues = passwordPolicyIssues(password);
    if (passwordIssues.length) {
      return res.status(400).json({
        error: {
          code: 'WEAK_PASSWORD',
          message: `Password must include ${passwordIssues.join(', ')}.`
        }
      });
    }

    const tokenHash = hashVerificationToken(token);
    const user = await User.findOne({
      email,
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() }
    });
    if (!user) {
      return res.status(400).json({
        error: {
          code: 'PASSWORD_RESET_INVALID',
          message: 'Password reset link is invalid or expired.'
        }
      });
    }

    user.password = await bcrypt.hash(password, 12);
    user.passwordChangedAt = new Date();
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    user.passwordResetRequestedAt = null;
    user.loginFailures = 0;
    user.lockUntil = null;
    await user.save();

    return res.json({ message: 'Password reset successful. You can sign in now.' });
  } catch (err) {
    console.error('password/reset error', err);
    return res.status(500).json({
      error: {
        code: 'PASSWORD_RESET_FAILED',
        message: 'Could not reset password.'
      }
    });
  }
});

module.exports = router;
module.exports.__test = {
  passwordPolicyIssues,
  suggestedUsernameFromProfile,
  isValidClientNonce,
  nonceMatches,
  normalizeIdentifier,
  normalizeEmail,
  normalizeUsername
};
