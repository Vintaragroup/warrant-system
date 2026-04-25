# Requested Credentials (Template)

Do not commit real secrets. Use this template locally and share values out-of-band.

## MongoDB Atlas
- MONGO_URI: mongodb+srv://<user>:<password>@<cluster-host>/?retryWrites=true&w=majority&appName=<AppName>
- MONGO_DB: warrantdb (or your db name)

## Firebase Web (SPA)
- VITE_FIREBASE_API_KEY: <api-key>
- VITE_FIREBASE_AUTH_DOMAIN: <project>.firebaseapp.com
- VITE_FIREBASE_PROJECT_ID: <project-id>
- VITE_FIREBASE_APP_ID: <app-id>
- VITE_FIREBASE_MEASUREMENT_ID: <measurement-id>
- VITE_API_URL: /api (or https://<api-host>)

## Firebase Admin (API)
- Secret File JSON contents pasted into Render as firebase.json
- Set GOOGLE_APPLICATION_CREDENTIALS=/opt/render/project/secrets/firebase.json

## Notes
- Keep MONGO_URI, Firebase Admin JSON, and any API keys out of git. Provide via env/secret managers.
- For production SPA on Render Static, set VITE_API_URL to your API URL.
- For single-origin later, remove VITE_API_URL and use /api with Nginx proxy.
