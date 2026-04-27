# Galveston V2 Read Toggle — Admin UI Discovery

**Date**: 2026-04-27  
**Status**: Discovery only — no code changes

---

## 1. Frontend / Admin Structure Summary

### Routes (`apps/dashboard/src/App.jsx`)

| Path                     | Component             | Auth                                         |
| ------------------------ | --------------------- | -------------------------------------------- |
| `/`                      | `Dashboard`           | `RequireAuth`                                |
| `/cases`                 | `Cases`               | `RequireAuth`                                |
| `/admin`                 | `Admin`               | `RequireAuth` + client-side Admin role check |
| `/auth/*`                | `AuthRoutes`          | Public                                       |
| `/auth/admin-users`      | `AdminUserManagement` | Session                                      |
| `/auth/profile-settings` | `ProfileSettings`     | Session                                      |

### Admin tab visibility (`apps/dashboard/src/layouts/AppLayout.jsx`)

The Admin nav tab is hidden unless the authenticated user's profile includes `'Admin'` in the `roles[]` array:

```js
if (t.requiresAdmin && !currentUser?.roles?.includes("Admin")) return null;
```

This is a client-side visibility gate only. The server does not enforce an Admin role on `/api/dashboard/*` routes — all require `requireAuth` (any authenticated user) but not a specific role.

### Current Admin page (`apps/dashboard/src/pages/Admin.jsx`)

The `/admin` page currently contains:

| Section         | Data source                                                |
| --------------- | ---------------------------------------------------------- |
| Automation jobs | **Hard-coded static array** (including `scrape:galveston`) |
| Integrations    | **Hard-coded static array**                                |
| Users & roles   | **Hard-coded static array**                                |
| Data freshness  | Live API via `useCases()` hook (last 25 bookings)          |

No runtime toggles, feature flags, or source controls exist on the Admin page today. The static job list is a UI shell only — "Run now" and "View logs" buttons have no backend action wired up.

---

## 2. Existing Feature Flag Pattern

The only existing feature flag is `USE_TIME_BUCKET_V2` (env-only):

**Server (`apps/dashboard/server/src/index.js` lines 164–165):**

```js
const USE_TIME_BUCKET_V2 =
  String(process.env.DISABLE_TIME_BUCKET_V2 || "false").toLowerCase() === "true"
    ? false
    : true;
app.locals.flags = { USE_TIME_BUCKET_V2 };
```

**Used in route handlers (`dashboard.js`):**

```js
const useV2 = !!req.app?.locals?.flags?.USE_TIME_BUCKET_V2;
```

**Pattern characteristics:**

- Set once at server startup from an environment variable
- Stored in `app.locals.flags` (server memory, request-accessible)
- No runtime mutation supported
- No `/api/flags` or `/api/admin/config` endpoint exists

---

## 3. Current Galveston Data Flow

### Collection names (server-side, 3 separate hard-coded locations)

| File                                        | Usage                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `server/src/routes/dashboard.js` line 137   | `COUNTY_COLLECTIONS` array — drives all `$unionWith` aggregations     |
| `server/src/routes/cases.js` lines 15, 24   | `COUNTY_COLLECTIONS` array + `COUNTY_MAP` for per-county case lookups |
| `server/src/routes/health.js` lines 46, 196 | Collection health checks                                              |

In all three files, Galveston reads from `'simple_galveston'`. There is **no reference to `v2_galveston_events`** anywhere in the dashboard server.

### Aggregation architecture (`dashboard.js`)

```
baseColl = db.collection('simple_brazoria')   ← BASE_COLLECTION (index 0 of COUNTY_COLLECTIONS)
  └── $unionWith('simple_fortbend')
  └── $unionWith('simple_galveston')          ← where v2 toggle would swap
  └── $unionWith('simple_harris')
  └── $unionWith('simple_jefferson')
```

All dashboard endpoints (`/kpi`, `/new`, `/recent`, `/per-county`, `/top`, `/diag`) fan out via `unionAll()` or `unionAllFast()`, which both iterate `COUNTY_COLLECTIONS`. Swapping the Galveston entry to `'v2_galveston_events'` would affect all of them simultaneously.

### Cases route (`cases.js`)

Uses a separate `COUNTY_MAP`:

```js
const COUNTY_MAP = new Map([
  ['galveston', 'simple_galveston'],
  ...
]);
```

Case detail lookups for Galveston route through this map independently of the dashboard aggregation.

### Frontend API calls (`src/hooks/dashboard.js`)

React Query hooks call:

- `GET /api/dashboard/kpi`
- `GET /api/dashboard/new`
- `GET /api/dashboard/recent`
- `GET /api/dashboard/per-county`
- etc.

Auth header: Firebase ID token via `getAuthHeader()` from `src/lib/api.js`. Base URL resolved from `window.__ENV__.VITE_API_URL` → `import.meta.env.VITE_API_URL` → `/api`.

### Auth middleware (`server/src/middleware/auth.js`)

`requireAuth` verifies a Firebase session cookie or Bearer token, upserts the user into MongoDB, and attaches `req.user = { uid, email, roles[], departments[], counties[], ... }`. All `/api/dashboard/*` and `/api/cases/*` routes pass through `requireAuth`.

No server-side role enforcement exists for dashboard reads (any authenticated user can read). Admin role enforcement would need to be added explicitly for the toggle endpoint.

---

## 4. No Runtime Admin Toggle Exists

Confirmed absent:

- No `/api/flags` endpoint
- No `/api/admin/*` endpoint
- No feature flag service, config collection, or remote config
- No toggle UI on the Admin page
- No `v2_galveston_events` reference in server routes

---

## 5. Recommendation — Approach D: Hybrid (env default + server-memory override)

### Why not the other approaches

| Approach                                            | Reason not preferred                                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Env-only**                                     | Requires a server restart to toggle; no admin UI path                                                                                                                 |
| **B. Admin UI toggle backed by Mongo**              | Overkill for a temporary migration toggle; adds DB dependency to a flag that changes the DB being read                                                                |
| **C. Admin UI toggle backed by server memory only** | Safe but loses state on restart, no audit trail, and the default would be wrong if env var is absent                                                                  |
| **D. Hybrid** ✅                                    | Env var sets safe default; admin can override in-memory without restart; reverts to env default on deploy/restart — aligns with existing `USE_TIME_BUCKET_V2` pattern |

### How it works

```
Startup:
  GALVESTON_USE_V2_COLLECTION = env var (default: false)
  app.locals.flags.galvestonUseV2Collection = GALVESTON_USE_V2_COLLECTION

Runtime (Admin UI):
  POST /api/admin/flags  { galvestonUseV2Collection: true/false }
  → updates app.locals.flags.galvestonUseV2Collection in place
  → no server restart, no DB write

On next request to /api/dashboard/*:
  COUNTY_COLLECTIONS[2] = flags.galvestonUseV2Collection
    ? 'v2_galveston_events'
    : 'simple_galveston'

Rollback:
  POST /api/admin/flags  { galvestonUseV2Collection: false }
  OR: remove env override, restart server
```

---

## 6. Implementation Plan

### Files to modify

| File                                            | Change needed                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/dashboard/server/src/index.js`            | Add `GALVESTON_USE_V2_COLLECTION` env read to `app.locals.flags`                                  |
| `apps/dashboard/server/src/routes/dashboard.js` | Change `COUNTY_COLLECTIONS` from a constant array to a function that reads `req.app.locals.flags` |
| `apps/dashboard/server/src/routes/cases.js`     | Change `COUNTY_MAP` entry for `'galveston'` to read from `req.app.locals.flags`                   |
| `apps/dashboard/server/src/routes/health.js`    | Make health check collection list flag-aware                                                      |
| `apps/dashboard/server/src/routes/admin.js`     | **New file**: `GET /api/admin/flags` + `POST /api/admin/flags`                                    |
| `apps/dashboard/src/pages/Admin.jsx`            | Add "Data Sources" section with Galveston V2 toggle card                                          |
| `apps/dashboard/server/.env` (or Render env)    | Add `GALVESTON_USE_V2_COLLECTION=false`                                                           |

### New API endpoint

```
GET  /api/admin/flags
     → 200 { galvestonUseV2Collection: boolean }

POST /api/admin/flags
     Body: { galvestonUseV2Collection: boolean }
     → 200 { ok: true, galvestonUseV2Collection: boolean }
```

**Auth requirement**: `requireAuth` + server-side Admin role check:

```js
if (!req.user?.roles?.includes("Admin")) {
  return res.status(403).json({ error: "Admin role required" });
}
```

**Route registration** in `index.js`:

```js
import adminRoutes from "./routes/admin.js";
app.use("/api/admin", requireAuth, adminRoutes);
```

### Frontend component

**Location**: `apps/dashboard/src/pages/Admin.jsx`  
Add a new `<SectionCard>` titled "Data Sources" below the existing sections.

```
┌──────────────────────────────────────────────────────┐
│ Data Sources                                          │
│ Control which MongoDB collection each county reads   │
│──────────────────────────────────────────────────────│
│ Galveston                                             │
│ Collection: [simple_galveston] ●○ [v2_galveston_events] │
│ Status: legacy (default)   [ Enable V2 ]             │
│                                                       │
│ ⚠ Enabling V2 affects all dashboard endpoints.       │
│   Revert by clicking Disable V2 or restarting server. │
└──────────────────────────────────────────────────────┘
```

**Data fetching**: new React Query hook `useAdminFlags()` → `GET /api/admin/flags`.  
**Mutation**: `useMutation` → `POST /api/admin/flags` with optimistic update and toast on success/failure.

### Persistence strategy

| Layer                       | Value                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| Default                     | `GALVESTON_USE_V2_COLLECTION` env var (Render dashboard → Environment)       |
| Runtime override            | `app.locals.flags.galvestonUseV2Collection` (server memory)                  |
| Persistence across restarts | Not automatic — by design. Promotes deliberate promotion via env var update. |
| Permanent promotion         | Set `GALVESTON_USE_V2_COLLECTION=true` in Render environment, redeploy       |

### Security / auth requirements

| Control                     | Required                                                                       |
| --------------------------- | ------------------------------------------------------------------------------ |
| `/api/admin/flags` endpoint | `requireAuth` (already used on all API routes)                                 |
| Role gating on server       | `req.user.roles.includes('Admin')` — must be server-side, not client-side only |
| Read endpoint (GET)         | Admin role required (don't expose flag state to all users)                     |
| Write endpoint (POST)       | Admin role required                                                            |
| Frontend tab visibility     | Already hidden for non-Admin users via `requiresAdmin: true` in AppLayout      |

### Rollback path

1. **Immediate**: Admin UI → click "Disable V2" → `POST /api/admin/flags { galvestonUseV2Collection: false }` → takes effect on next request, no restart needed.
2. **Persistent**: Ensure `GALVESTON_USE_V2_COLLECTION=false` in Render env, then redeploy.
3. **Emergency**: Server restart reverts to env default automatically (if env is `false`).

---

## 7. Risks

| Risk                                                                         | Severity | Mitigation                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `v2_galveston_events` has only ~5 docs                                       | High     | Require staging cron to run for ≥1 week before enabling                                                                                    |
| `county` field is lowercase `"galveston"` in v2 vs title-case legacy         | Medium   | Already partially handled — `COUNTY_COLLECTIONS` drives `$unionWith` not filter; `county` filter strings in frontend use lowercase already |
| `booking_date_n` derivation in `unionAll` uses `booked_at` fallback          | Low      | Compatibility alias `booked_at` was added to v2 in Task 6                                                                                  |
| `booking_age_category` / `booking_priority` absent from v2                   | Medium   | Dashboard currently derives these; verify no hard-coded queries                                                                            |
| `status` / `facility` / `released_at` absent from v2                         | Medium   | Dashboard does not query these directly; verify before enabling                                                                            |
| `cases.js` `COUNTY_MAP` is separate from `dashboard.js` `COUNTY_COLLECTIONS` | Medium   | Must update both in same PR — easy to miss                                                                                                 |
| `health.js` collection list is also separate                                 | Low      | Flag-aware health check needed so health endpoint reports correct state                                                                    |
| In-memory flag state not synced across multiple server instances             | Medium   | Render runs single instance for this service; acceptable for now                                                                           |
| No audit trail for toggle actions                                            | Low      | Log toggle event to console; optional: write to MongoDB audit log                                                                          |

---

## 8. Validation Checklist

Before enabling V2 for the first time:

- [ ] `v2_galveston_events` has ≥ 100 recent documents (staging cron enabled ≥1 week)
- [ ] `v2_galveston_events` has `county`, `booking_date`, `booked_at`, `bond_amount`, `full_name`, `charges`, `charge_description` present
- [ ] `GALVESTON_USE_V2_COLLECTION=false` set in Render env (safe default confirmed)
- [ ] New `/api/admin/flags` endpoint returns 200 for Admin user, 403 for non-Admin
- [ ] Toggle ON: Galveston card on `/admin` shows "v2_galveston_events" state
- [ ] Toggle ON: Dashboard `/kpi` response includes Galveston data (non-zero counts)
- [ ] Toggle ON: Dashboard `/per-county` includes `{ county: "galveston" }` row
- [ ] Toggle ON: Case search for county=galveston returns results
- [ ] Toggle ON: Health endpoint `/api/health` reports `v2_galveston_events` as healthy
- [ ] Toggle OFF: Immediately reverts to `simple_galveston` on next request
- [ ] Server restart: reverts to env default correctly

---

## 9. Files Not to Touch (Constraints)

- `services/warrantdb-pipeline/ingestion/**` — no ingestion code changes
- `services/warrantdb-pipeline/scripts/**` — no pipeline scripts
- MongoDB collections — no writes
- V2 read not enabled yet — discovery only
