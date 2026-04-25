import { readFileSync, existsSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Resolve Firebase Admin credentials path. Prefer explicit env var, but also
// check common container secret mount locations to reduce deploy friction.
const candidatePaths = [
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  '/etc/secrets/firebase.json',
  '/opt/render/project/secrets/firebase.json',
].filter(Boolean);

let resolvedPath = null;
for (const p of candidatePaths) {
  try {
    if (p && existsSync(p)) { resolvedPath = p; break; }
  } catch {}
}

if (!resolvedPath) {
  throw new Error('Firebase Admin credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS to your secret file (e.g., /etc/secrets/firebase.json) or ensure the file exists at a known path.');
}

const serviceAccount = JSON.parse(readFileSync(resolvedPath, 'utf8'));

const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

export const firebaseAuth = getAuth(firebaseApp);
