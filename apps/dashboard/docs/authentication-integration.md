# Authentication Integration Plan (Firebase Authentication)

## 1. Executive Summary
- Adopt Firebase Authentication to deliver email/password, passwordless, Google, Apple, and additional OAuth providers with minimal infrastructure cost.
- Keep existing Express + MongoDB stack; Firebase only handles identity, while role and profile data live in MongoDB.
- Implement secure role-based access (Super User, Admin, Department Lead, Employee, Sales, Bond Client) backed by server-side policy enforcement.
- Leverage Firebase free tier (first 50K MAUs) and pay-as-you-go SMS/MFA to keep costs predictable.

## 2. Rationale and Cost Analysis
- **Pricing:** Firebase Authentication offers a generous free tier (email/password & anonymous sign-in free, first 10K SMS/MFA per month included, thereafter ~$0.01 per SMS depending on region).
- **Provider coverage:** Built-in OAuth templates for Google, Apple, Microsoft, Facebook, GitHub; supports custom SAML/OIDC if enterprise needs grow.
- **Operational simplicity:** Hosted login, session management, and secure token issuance reduce maintenance overhead.
- **Tooling ecosystem:** Official SDKs for Web (React), Node (firebase-admin), and REST APIs for other services.
- **Compliance:** Google Cloud-managed infrastructure with SOC2, ISO 27001, HIPAA (BAA required) certificates; satisfies majority of SMB regulatory expectations.
- **Alternatives considered:**
  - **Auth0:** Excellent enterprise features but higher per-MAU costs after the free tier.
  - **Clerk/Supabase:** Competitive pricing but tighter coupling to their ecosystems; Firebase is more neutral and integrates cleanly with existing MongoDB data.

## 3. High-Level Architecture
```
[ Client (React SPA) ] --(Firebase SDK)--> [ Firebase Auth ]
             |                                 |
             |  ID token + refresh token       |
             +----> [ Express API ] --(firebase-admin verify)--> [ Role service (MongoDB) ]
```
- Frontend handles interactive sign-in via Firebase Hosted UI or custom UI.
- Firebase issues ID tokens; client stores refresh tokens securely (HTTP-only cookies via backend or Web storage with safeguards).
- Express middleware validates ID tokens via `firebase-admin`, resolves user profile & role info from MongoDB, and injects authorization context into request.
- Role assignments stored in a `users` collection, keyed by Firebase UID, with fields for role, departments, audit metadata.

## 4. Required Resources
- Google Cloud project with Firebase enabled.
- Service account for server-side token verification (JSON key stored in secrets manager).
- Domain ownership (for Apple Sign-In and custom email domain if required).
- Updated privacy policy and terms referencing Google identity services.

## 5. Implementation Roadmap
1. **Project Setup (Firebase Console)**
   - Create Firebase project or select existing Google Cloud project.
   - Enable Authentication, configure authorized domains (development + production).
   - Generate Web API key and app configuration snippet (for React app).
   - Create a service account with `Firebase Admin SDK Administrator Service Agent` role; download JSON credentials for secure storage.
2. **Provider Configuration**
   - Email/Password: enable in Authentication > Sign-in methods; configure password strength policy.
   - Email link (passwordless): enable and define action URL template.
   - Google: enable; supply OAuth consent screen details.
   - Apple: enable; register bundle ID/service ID, create key & add to Firebase; ensure domain association file is deployed under `/.well-known/apple-developer-domain-association.txt`.
   - (Optional) Additional providers as needed.
3. **MFA Enforcement**
   - In Firebase Authentication > MFA, require MFA for Super User/Admin (policy enforcement handled in backend; Firebase supports TOTP and SMS for enrolled users).
4. **Backend Integration**
   - Install `firebase-admin` in `server` project.
   - Store service account JSON in secrets manager; expose path via env var (e.g., `GOOGLE_APPLICATION_CREDENTIALS`).
   - Add Express middleware for token validation and role resolution.
   - Extend user provisioning flow to create MongoDB profile document on first login.
5. **Frontend Integration**
   - Install `firebase` SDK in root project.
   - Initialize Firebase app with env-based config (Vite env vars prefixed with `VITE_`).
   - Build UI flows (choice: FirebaseUI library or custom React components) for sign-in/sign-up and MFA enrollment.
   - Consume backend APIs with ID token attached (Authorization: Bearer) or rely on secure cookies set by backend session endpoint.
6. **Role & Access Control Layer**
   - Define `roles` collection or config mapping to permissions.
   - Implement Express authorization middleware to enforce per-route permissions.
   - Seed initial Super User account, with emergency break-glass procedure documented.
7. **Testing & Launch**
   - Write integration tests mocking Firebase with emulator or test tenants.
   - Perform staging rollout; validate login, token refresh, role enforcement, and audit logging.
   - Document activation steps for operations team; prepare incident response playbook.

## 6. Backend Integration Details
- **Dependencies:**
  ```bash
  npm --prefix server install firebase-admin
  ```
- **Environment variables (`server/.env`):**
  - `GOOGLE_APPLICATION_CREDENTIALS=/secure/path/firebase-admin.json`
  - `FIREBASE_PROJECT_ID=...`
  - `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099` (only for local testing)
- **Initialization (`server/src/lib/firebaseAdmin.js`):**
  ```js
  import { readFileSync } from 'node:fs';
  import { initializeApp, cert } from 'firebase-admin/app';
  import { getAuth } from 'firebase-admin/auth';

  const firebaseApp = initializeApp({
    credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'))),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  export const firebaseAuth = getAuth(firebaseApp);
  ```
- **Token verification middleware (`server/src/middleware/auth.js`):**
  ```js
  import { firebaseAuth } from '../lib/firebaseAdmin.js';
  import { User } from '../models/User.js';

  export async function requireAuth(req, res, next) {
    try {
      const token = extractBearerToken(req); // parse Authorization header or cookie
      const decoded = await firebaseAuth.verifyIdToken(token, true);
      const profile = await User.findOne({ uid: decoded.uid });

      req.user = {
        uid: decoded.uid,
        email: decoded.email,
        roles: profile?.roles ?? [],
        departments: profile?.departments ?? [],
      };

      return next();
    } catch (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
  }
  ```
- **Role enforcement:** Add helper `requireRole('Admin')`, `requirePermission('cases:view')`, etc., referencing policy matrix stored in config.
- **User model (`server/src/models/User.js`):** extend existing Mongoose schema to include Firebase UID, roles, MFA status, audit timestamps.

## 7. Frontend Integration Details
- **Dependencies:**
  ```bash
  npm install firebase
  ```
- **Environment variables (`.env` consumed by Vite):**
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_APP_ID`
  - `VITE_FIREBASE_MEASUREMENT_ID` (optional)
- **Initialization (`src/lib/firebaseClient.js`):**
  ```js
  import { initializeApp } from 'firebase/app';
  import { getAuth } from 'firebase/auth';

  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  const app = initializeApp(firebaseConfig);
  export const auth = getAuth(app);
  ```
- **Sign-in UI:**
  - Option A: Use FirebaseUI Web for rapid deployment; customize to include Email, Google, Apple.
  - Option B: Build custom React components using `signInWithEmailAndPassword`, `signInWithPopup(GoogleAuthProvider)`, `signInWithRedirect(AppleAuthProvider)`.
  - Capture ID token with `onAuthStateChanged`; forward to backend via `fetch` requests (Authorization header) or call a backend `/session` endpoint that exchanges ID token for HTTP-only session cookie.
- **MFA enrollment:** Utilize `getMultiFactorResolver` for challenge flows; provide UI for TOTP QR code or SMS enrollment based on policy.

## 8. Role & Profile Management
- Maintain `users` collection with schema:
  ```json
  {
    "uid": "firebase-uid",
    "email": "user@example.com",
    "roles": ["DepartmentLead"],
    "departments": ["North"],
    "status": "active",
    "mfaRequired": true,
    "createdAt": ISODate,
    "updatedAt": ISODate
  }
  ```
- Provisioning flow:
  1. Firebase user authenticates first time.
  2. Backend `POST /users/sync` (invoked post-login) ensures Mongo profile exists.
  3. Admin console (future UI) allows Super User/Admin to update roles/access.
- Super User bootstrap: manually insert record with `roles: ['SuperUser']` linked to designated Firebase UID; document break-glass procedure (e.g., direct DB update with dual approval).

## 9. Environment & Secrets Management
- Store Firebase service account JSON in secure secrets manager (1Password, AWS Secrets Manager, Google Secret Manager) rather than repository.
- CI/CD injects required env vars at build/deploy time.
- Rotate OAuth client secrets yearly or on incident; track in secret inventory.
- Document local setup using Firebase Emulator for development to avoid charges.

## 10. Testing Strategy
- Use Firebase Authentication Emulator for integration tests; script seeding of test users/claims.
- Add server-side unit tests that mock `firebaseAuth.verifyIdToken` to ensure middleware handles roles and errors.
- End-to-end tests covering signup, social login, MFA challenge, role-based access screens.
- Penetration test focus: token replay, privilege escalation, audit logging completeness.

## 11. Deployment & Rollout Plan
1. **Phase 0:** Implement behind feature flag; run in parallel with current auth (if any) for internal testing.
2. **Phase 1:** Migrate Super User/Admin accounts; validate role management workflows.
3. **Phase 2:** Invite Department Leads and employees; monitor metrics (auth success, error rate).
4. **Phase 3:** Enable Bond Client portal once staff adoption is stable.
5. **Fallback:** Maintain ability to disable Firebase login via config flag; document manual revocation procedures.

## 12. Cost Monitoring
- Track monthly active users via Firebase Analytics dashboard.
- Set budget alerts in Google Cloud Billing for thresholds (e.g., $25, $50).
- Monitor SMS usage; prefer TOTP for high-volume users to reduce per-message charges.
- Evaluate upgrade to Blaze plan if additional providers or high usage emerges; still pay-as-you-go.

## 13. Account & Key Activation Checklist
- [ ] Create/Select Firebase project and enable Authentication.
- [ ] Add development and production domains to Authorized domains list.
- [ ] Enable Email/Password and configure password reset email branding.
- [ ] Enable Email Link sign-in with action URLs pointing to `https://<domain>/auth/action`.
- [ ] Enable Google provider; configure OAuth consent screen (production app verification may be required for restricted scopes).
- [ ] Enable Apple provider; complete Apple Developer setup (Service ID, Team ID, private key); upload domain association file via Express static route.
- [ ] Generate Web app credentials; record API key, Auth domain, Project ID, App ID.
- [ ] Create service account (Firebase Admin SDK) and store JSON in secrets vault.
- [ ] Share API keys and service account path with DevOps via secure channel; never commit secrets to Git.
- [ ] Configure environment variables in deployment pipelines (Vite + Express).
- [ ] Populate Super User record in MongoDB referencing known Firebase UID.
- [ ] Document support runbooks for password reset, MFA reset, and account suspension.

## 14. Open Decisions

## 15. Next Steps (Post-Approval)
 ````

## 2025-09-29 Production bring-up (Render)

We deployed a public-facing production using Render’s onrender.com URLs without a custom domain yet. We are temporarily using separate origins (Static SPA + Docker API). See `docs/production-deployment.md` for the runbook.

Highlights
- SPA (Static Site) sets `VITE_API_URL` to the API’s onrender.com URL. Requests include credentials and cookies are sent cross-origin.
- API CORS `origin` allowlist includes the SPA origin via `WEB_ORIGIN`; cookies are `Secure` + `SameSite=None` in production.
- Firebase Authorized domains now include the SPA onrender.com domain.
- MongoDB Atlas connectivity verified via `/api/health`.

Next
- When a custom domain is ready, migrate to single-origin (Nginx proxy /api), remove `VITE_API_URL`, and keep same-origin cookies.

 ## 2025-09-28 Integration Fix Log — Firebase + Mongo data visible in Frontend

 This section documents the concrete changes made to resolve the blank screen/auth errors and 404s, and to ensure the SPA connects to the API (MongoDB Atlas) reliably in development, staging, and production.

 Summary
 - Root cause: The SPA sometimes baked a dev URL (http://localhost:8080) into production bundles and attempted cross-origin requests, leading to cookies not being sent and CORS/404 issues. Separately, Firebase client config was read too early and sometimes missing at runtime, causing `[auth/invalid-api-key]` and a blank screen.
 - Fixes: Introduced a runtime env loader (`public/env.js`) and deferred app boot until it loads. Centralized API base resolution to default to same-origin `/api` in production, with runtime override first and dev-only build-time fallback. Ensured credentials mode is `include` in fetch helpers so HTTP-only session cookies flow.

 Frontend runtime environment
 - File: `public/env.js` with example at `public/env.example.js`.
 - The app bootstraps by loading `/env.js` if present and only then rendering `App` (see `src/main.jsx`).
 - Keys supported (window.__ENV__):
   - `VITE_API_URL` — Preferred API base at runtime. In production we omit absolute hosts and use `/api` for same-origin proxying.
   - `VITE_FIREBASE_*` — Optional overrides for Firebase web config if you must change without rebuild.

 API base resolution (production-safe)
 - Central logic (see `src/lib/api.js` and consumer hooks under `src/hooks/`):
   1) If `window.__ENV__.VITE_API_URL` exists, use it.
   2) Else if build-time `import.meta.env.VITE_API_URL` exists AND we are in development, use it.
   3) Otherwise default to `'/api'`.
 - Trailing slash is normalized off, and all requests use `credentials: 'include'`.
 - Production bundles no longer contain `http://localhost:8080`. We verified by building and scanning `dist/` for that string (none found).

 Nginx and dev proxy alignment
 - Nginx configuration proxies `location /api` to the API container, so the SPA can use same-origin calls without embedding hostnames.
 - Vite dev proxy maps `/api` → `http://localhost:8080` for local dev, keeping frontend code unchanged between environments.

 Firebase client init stability
 - The SPA now defers `App` import/render until after optional `/env.js` loads (see `src/main.jsx`). This prevents reading undefined Firebase keys during cold loads.
 - Firebase initialization guards use runtime env first, then build-time. If keys are missing, a console error is shown with explicit guidance.

 Cookie/CORS posture
 - All fetch helpers specify `credentials: 'include'` by default; the API sets the session cookie on the same origin. This avoids cross-origin cookie restrictions and preflight complexity.
 - `WEB_ORIGIN` must match the public origin of the web app; ensure it is set in the API environment (Compose/Render). In local staging we set `WEB_ORIGIN=http://localhost:5173`.

 MongoDB Atlas connectivity
 - The API container reads `MONGO_URI` and `MONGO_DB` (default `warrantdb`). In CI and staging compose, we inject these via environment.
 - Health endpoints `/api/health` and `/api/health/light` reflect Atlas connectivity and basic counts; they are used by smoke tests.

 Verification steps performed
 1) Searched app source and production `dist/` for `localhost:8080` → none present in the final build.
 2) Launched staging compose; hit `/api/health` successfully.
 3) Ran smoke scripts:
    - `node server/scripts/smoke-health.mjs --base http://localhost:8080`
    - `node server/scripts/smoke-dashboard.mjs --base http://localhost:8080/api/dashboard`
 4) Opened SPA; ensured requests go to `/api/*` and set cookies. Firebase auth no longer errors; login proceeds.

 Operational notes
 - In Render: set SPA `VITE_API_URL` to your API public URL only if you choose not to reverse-proxy; otherwise leave default and rely on same-origin `/api`.
 - Prefer runtime `/env.js` overrides sparingly; for stable environments, keep config in CI/CD and container args.

 Acceptance criteria (met)
 - No hard-coded dev hostnames in production JS bundle.
 - SPA successfully obtains Firebase config and renders without `[auth/invalid-api-key]`.
 - Authenticated requests include cookies and hit `/api/*` via same-origin proxy.
 - Health and dashboard endpoints return data backed by MongoDB Atlas.

 ```

