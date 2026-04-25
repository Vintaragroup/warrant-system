# Credentials → Environment Mapping

Use this as a guide to translate provided credentials into platform environment variables (Render) without committing secrets.

## MongoDB Atlas (API)
- Input: full connection string (username, password, cluster host) and database name
- Env vars (API service):
  - MONGO_URI = mongodb+srv://<user>:<pass>@<cluster>/?retryWrites=true&w=majority&appName=<AppName>
  - MONGO_DB = warrantdb (or the provided DB)

Notes:
- If Atlas enforces an IP allowlist, add the Render outbound IP(s) for the API service.

## Firebase Admin (API)
- Input: Service account JSON
- Render setup:
  - Add a Secret File in the API service named firebase.json containing the JSON.
  - Env var: GOOGLE_APPLICATION_CREDENTIALS=/opt/render/project/secrets/firebase.json
  - Env var: FIREBASE_PROJECT_ID=<project-id>
- Local dev:
  - Keep the JSON in `server/.secrets/` (ignored by git).
  - `server/.env` points `GOOGLE_APPLICATION_CREDENTIALS=.secrets/<file>.json` so host tooling can read it.
  - Docker Compose mounts the same file as a secret and injects `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase`, so no host path escapes the container.

## Firebase Web (SPA)
- Input: Web config object (apiKey, authDomain, projectId, appId, measurementId)
- Env vars (Static site):
  - VITE_FIREBASE_API_KEY=<apiKey>
  - VITE_FIREBASE_AUTH_DOMAIN=<authDomain>
  - VITE_FIREBASE_PROJECT_ID=<projectId>
  - VITE_FIREBASE_APP_ID=<appId>
  - VITE_FIREBASE_MEASUREMENT_ID=<measurementId>
  - VITE_API_URL=https://<api-service>.onrender.com

Additional Steps:
- Firebase Console → Authentication → Authorized domains: add the SPA onrender.com domain
- API CORS: set WEB_ORIGIN to the SPA origin (comma-separated if multiple)

## Validation
- API: <API_URL>/api/health should return ok and db.status present
- SPA: Load <SPA_URL>, sign in, observe Secure, SameSite=None cookie and successful /api calls
