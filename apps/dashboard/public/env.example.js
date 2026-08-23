// Optional runtime env injection. Copy to public/env.js and adjust values.
// This file will be served as /env.js and read by the app at runtime if present.
window.__ENV__ = {
  VITE_API_URL: '/api',
  DEV_ERROR_OVERLAY: 'false',
};
