#!/usr/bin/env node
import '../src/config/loadEnv.js';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectMongo } from '../src/db.js';
import User from '../src/models/User.js';

function parseArgs() {
  const args = new Map();
  for (const token of process.argv.slice(2)) {
    if (!token.startsWith('--')) continue;
    const [key, value] = token.slice(2).split('=');
    args.set(key, value ?? true);
  }
  return args;
}

async function promptIfNeeded(args) {
  const rl = readline.createInterface({ input, output });
  try {
    if (!args.has('email')) {
      const email = await rl.question('Email: ');
      if (email) args.set('email', email.trim());
    }
    if (!args.has('password')) {
      const password = await rl.question('Password (8+ chars): ');
      if (password) args.set('password', password.trim());
    }
    if (!args.has('displayName')) {
      const displayName = await rl.question('Display name (optional): ');
      if (displayName) args.set('displayName', displayName.trim());
    }
  } finally {
    rl.close();
  }
}

function assertArgs(args) {
  const email = args.get('email');
  const password = args.get('password');
  if (!email) throw new Error('Missing required --email argument');
  if (!password) throw new Error('Missing required --password argument');
  if (password.length < 8) throw new Error('Password must be at least 8 characters long');
  return {
    email: email.trim().toLowerCase(),
    password,
    displayName: args.get('displayName'),
    roles: args.has('roles') ? String(args.get('roles')).split(',').filter(Boolean) : ['SuperUser'],
  };
}

async function main() {
  const args = parseArgs();
  await promptIfNeeded(args);
  const { email, password, displayName, roles } = assertArgs(args);

  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  const MONGO_DB = process.env.MONGO_DB || process.env.MONGODB_DB || 'warrantdb';
  if (!MONGO_URI) throw new Error('MONGO_URI is not set');
  await connectMongo(MONGO_URI, MONGO_DB);

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ email }).select('+passwordHash');

  const doc = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        uid: existing?.uid || crypto.randomUUID(),
        email,
        displayName: displayName || existing?.displayName || '',
        roles,
        status: 'active',
        emailVerified: true,
        passwordHash,
      },
      $inc: { sessionVersion: 1 }, // invalidate any stale sessions on password change
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  console.log(`\n✅ Local user ready`);
  console.log(`   uid: ${doc.uid}`);
  console.log(`   email: ${doc.email}`);
  console.log(`   roles: ${doc.roles.join(', ')}`);
  console.log(`\nSign in with this email/password at ${process.env.WEB_ORIGIN || 'http://localhost:5173'}/auth/login`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to create local user:', err.message || err);
  process.exitCode = 1;
});
