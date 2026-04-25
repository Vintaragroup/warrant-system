import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const RUNTIME_ENV = (typeof window !== 'undefined' && (window as any).__ENV__) || {} as Record<string, string>;

const firebaseConfig = {
  apiKey: RUNTIME_ENV.VITE_FIREBASE_API_KEY ?? import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: RUNTIME_ENV.VITE_FIREBASE_AUTH_DOMAIN ?? import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: RUNTIME_ENV.VITE_FIREBASE_PROJECT_ID ?? import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: RUNTIME_ENV.VITE_FIREBASE_APP_ID ?? import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: RUNTIME_ENV.VITE_FIREBASE_MEASUREMENT_ID ?? import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

if (
  !firebaseConfig.apiKey ||
  !firebaseConfig.authDomain ||
  !firebaseConfig.projectId ||
  !firebaseConfig.appId
) {
  // Surface a helpful error in dev to avoid confusing Firebase [auth/invalid-api-key]
  const missing = Object.entries(firebaseConfig)
    .filter(([_, v]) => !v)
    .map(([k]) => k)
    .join(', ');
  // eslint-disable-next-line no-console
  console.error(
    `Firebase config is incomplete. Missing: ${missing}. ` +
      'Ensure VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID are set at build time.'
  );
}

const app = initializeApp(firebaseConfig);

export const firebaseAuthClient = getAuth(app);
export default app;
