#!/usr/bin/env node
import '../src/config/loadEnv.js';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { firebaseAuth } from '../src/lib/firebaseAdmin.js';

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
  if (!email) {
    throw new Error('Missing required --email argument');
  }
  if (!password) {
    throw new Error('Missing required --password argument');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  return { email: email.trim().toLowerCase(), password, displayName: args.get('displayName') };
}

async function main() {
  const args = parseArgs();
  await promptIfNeeded(args);
  const { email, password, displayName } = assertArgs(args);

  try {
    let userRecord;
    try {
      userRecord = await firebaseAuth.getUserByEmail(email);
      console.log(`Found existing Firebase user for ${email}. Updating password/displayName...`);
      await firebaseAuth.updateUser(userRecord.uid, {
        password,
        displayName: displayName || userRecord.displayName || undefined,
      });
      userRecord = await firebaseAuth.getUser(userRecord.uid);
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') {
        throw err;
      }
      userRecord = await firebaseAuth.createUser({
        email,
        password,
        displayName: displayName || undefined,
      });
      console.log('Created new Firebase user.');
    }

    console.log('\n⚙️  Firebase user ready');
    console.log(`   uid: ${userRecord.uid}`);
    console.log(`   email: ${userRecord.email}`);
    if (userRecord.displayName) {
      console.log(`   displayName: ${userRecord.displayName}`);
    }
    console.log('\nNext steps:');
    console.log('  1) Insert a SuperUser record in MongoDB using the uid above.');
    console.log('  2) Restart the API and sign in with this account.');
  } catch (err) {
    console.error('Failed to create Firebase user:', err.message || err);
    process.exitCode = 1;
  }
}

main();
