require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const DEFAULT_PASSWORD = 'Password123!';

async function upsertUser({ username, email, role, password }) {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const passwordHash = await bcrypt.hash(String(password || ''), 12);

  let user = await User.findOne({ username: normalizedUsername });
  if (!user && normalizedEmail) {
    user = await User.findOne({ email: normalizedEmail });
  }

  if (!user) {
    user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password: passwordHash,
      role,
      emailVerified: true,
      loginFailures: 0,
      lockUntil: null,
      passwordChangedAt: new Date()
    });
    return { action: 'created', user };
  }

  user.username = normalizedUsername;
  user.email = normalizedEmail;
  user.password = passwordHash;
  user.role = role;
  user.emailVerified = true;
  user.loginFailures = 0;
  user.lockUntil = null;
  user.passwordChangedAt = new Date();
  await user.save();
  return { action: 'updated', user };
}

async function run() {
  const mongoUri = String(process.env.MONGODB_URI || '').trim();
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required to seed users.');
  }

  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  const users = [
    { username: 'admin', email: 'admin@chatroom.local', role: 'admin', password: DEFAULT_PASSWORD },
    { username: 'mod', email: 'mod@chatroom.local', role: 'moderator', password: DEFAULT_PASSWORD }
  ];

  for (const config of users) {
    const result = await upsertUser(config);
    console.log(`${result.action}: ${result.user.username} (${result.user.role})`);
  }

  await mongoose.disconnect();
}

run()
  .then(() => {
    console.log('Role seed complete.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Role seed failed:', err.message);
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
    process.exit(1);
  });
