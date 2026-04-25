// Optional runtime env injection. Copy to public/env.js and adjust values.
// This file will be served as /env.js and read by the app at runtime if present.
window.__ENV__ = {
  VITE_API_URL: '/api',
  DEV_ERROR_OVERLAY: 'false',
  VITE_FIREBASE_API_KEY: '',
  VITE_FIREBASE_AUTH_DOMAIN: '',
  VITE_FIREBASE_PROJECT_ID: '',
  VITE_FIREBASE_APP_ID: '',
  VITE_FIREBASE_MEASUREMENT_ID: '',
};
