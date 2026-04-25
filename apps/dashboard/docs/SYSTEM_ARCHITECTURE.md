# Bail Bonds Dashboard System Architecture

## Overview

The Bail Bonds Dashboard is a full-stack application that provides real-time visibility into bail bond cases across multiple Texas counties. The system reads raw inmate data from normalized MongoDB collections and surfaces it through a React-based dashboard, with CRM and enrichment capabilities.

**Key Rule**: There is **no separate `cases` collection**. The system reads directly from county-specific collections (`simple_harris`, `simple_jefferson`, etc.) and dynamically constructs case objects on-the-fly using fields within each document.

---

## Data Flow

### 1. Data Sources → MongoDB Collections

```
Raw Inmate Data
    ↓
Normalizer (external process)
    ↓
MongoDB Collections:
  - simple_harris (13,459 docs)
  - simple_jefferson (661 docs)
  - simple_brazoria (3,140 docs)
  - simple_galveston (5,455 docs)
  - simple_fortbend (858 docs)
```

**Input**: Raw inmate records from county jail systems (Harris, Jefferson, Brazoria, Galveston, Fort Bend).

**Normalizer**: An external process transforms raw data into consistent field names (e.g., `full_name`, `booking_date`, `bond_amount`, `case_number`, `spn`, `phone_nbr1`, etc.).

**Output**: Five MongoDB collections, one per county, with normalized schema.

### 2. API Layer Reads Collections

```
GET /api/cases?county=harris&minBond=5000&window=24h
    ↓
server/src/routes/cases.js (GET / endpoint)
    ↓
Queries simple_harris directly (via aggregation)
    ↓
Returns filtered/sorted list of 25 cases
```

**Key Change (Dec 8, 2025)**: The `/api/cases` endpoint now queries county collections directly instead of a normalized `cases` collection. This aligns with your system design where case documents live in their source collections.

### 3. Frontend Displays Cases

```
React Component (Pages/Cases.jsx, Pages/CaseDetail.jsx)
    ↓
useQuery hook (TanStack Query)
    ↓
GET /api/cases, GET /api/cases/:id
    ↓
Display formatted case list/detail
```

---

## Folder Structure & Purpose

### Root Level

```
/Bail-Bonds-Dashboard/
├── docker-compose.dev.yml         Dev Docker stack (web, api, mongo, redis, mailhog)
├── docker-compose.override.yml    Environment overrides
├── docker-compose.staging.yml      Staging-specific compose
├── Dockerfile.web                 Web (Vite) Docker image
├── render.yaml                    Render.io deployment config
├── package.json                   Root/web dependencies
├── tsconfig.json                  TypeScript config (frontend)
├── vite.config.js                 Vite build config
├── vitest.config.ts               Vitest test config
└── index.html                     SPA entry point
```

### `/public/` — Static Assets & Runtime Config

```
/public/
├── env.js                         ← CRITICAL: Runtime Firebase config loaded in index.html
├── env.example.js                 Template for env.js
└── [other static assets]
```

**Purpose**: Contains runtime environment variables (Firebase credentials, API URL) that are injected at page load. The `env.js` file must be loaded via `<script src="/env.js"></script>` in `index.html` before the app initializes.

### `/src/` — React Frontend Code

```
/src/
├── main.jsx                       App entry point (React 19)
├── App.jsx                        Router & layout wrapper
├── App.css                        Global styles
├── firebaseClient.ts              Firebase SDK init (reads window.__ENV__)
│
├── pages/
│   ├── Dashboard.jsx              Main dashboard view (stats, KPIs, alerts)
│   ├── Cases.jsx                  Case list with filters, sorting
│   ├── CaseDetail.jsx             Single case detail view (CRM, documents, activity)
│   ├── Prospects.jsx              High-bond recent cases discovery (NEW)
│   ├── Reports.jsx                Analytics & reporting
│   ├── Auth.jsx                   Authentication page
│   └── CRM.jsx                    CRM module (customer relationship management)
│
├── components/
│   ├── [UI components]            Radix UI + custom components
│   ├── DataTable.jsx              Reusable table component
│   └── [various feature components]
│
├── hooks/
│   ├── cases.js                   useCase, useCases, useCaseMeta (TanStack Query)
│   ├── dashboard.js               Dashboard stats hooks
│   ├── enrichment.js              Enrichment API hooks (stubs, ready for integration)
│   ├── useAuth.ts                 Firebase auth context
│   └── [other domain hooks]
│
├── lib/
│   ├── api.js                     HTTP client (fetch wrapper, auth header injection)
│   ├── firebaseClient.ts          Firebase initialization
│   └── [utility functions]
│
├── layouts/
│   ├── AppLayout.jsx              Top nav, sidebar, main layout
│   └── AuthLayout.jsx             Auth pages layout
│
└── styles/
    └── [global CSS, Tailwind config]
```

**Key Files**:
- **`firebaseClient.ts`**: Initializes Firebase Auth SDK. Reads credentials from `window.__ENV__` (set by `/public/env.js`).
- **`lib/api.js`**: HTTP client that injects Firebase ID token as `Authorization: Bearer <token>` header.
- **`hooks/cases.js`**: TanStack Query hooks for `/api/cases`, `/api/cases/:id`, `/api/cases/stats` endpoints.
- **`pages/Prospects.jsx`**: New page for discovering high-bond cases (24–72h windows). Uses `useCases()` hook with filters.
- **`pages/CaseDetail.jsx`**: Displays case details, CRM fields, documents, activity log, enrichment panel.

### `/server/` — Node.js/Express Backend

```
/server/
├── Dockerfile                     API Docker image
├── package.json                   Backend dependencies (Express, Mongoose, Firebase Admin)
│
├── src/
│   ├── index.js                   Express app entry point
│   ├── openapi.yaml               OpenAPI/Swagger spec
│   │
│   ├── models/
│   │   ├── Case.js                Mongoose schema for 'cases' collection (metadata storage)
│   │   ├── Message.js             Message model
│   │   ├── User.js                User model with roles, Firebase UID
│   │   ├── CaseAudit.js           CaseAudit model (activity log)
│   │   ├── CaseEnrichment.js       CaseEnrichment model (enrichment results cache)
│   │   └── [other models]
│   │
│   ├── routes/
│   │   ├── cases.js               **GET /api/cases** (queries simple_harris directly)
│   │   │                          **GET /api/cases/:id**
│   │   │                          **GET /api/cases/stats**
│   │   │                          **PATCH /api/cases/:id** (CRM updates)
│   │   │
│   │   ├── dashboard.js           **GET /api/dashboard/kpis**
│   │   │                          **GET /api/dashboard/trends**
│   │   │                          **GET /api/dashboard/top** (top 10 by bond)
│   │   │                          etc.
│   │   │
│   │   ├── enrichment.js          **GET /api/enrichment/providers**
│   │   │                          **POST /api/enrichment/:providerId/run**
│   │   │                          (Proxy to enrichment API at localhost:4000)
│   │   │
│   │   ├── auth.js                **POST /api/auth/register**
│   │   │                          **POST /api/auth/login**
│   │   │                          **GET /api/auth/session**
│   │   │
│   │   └── [other routes]
│   │
│   ├── lib/
│   │   ├── roles.js               RBAC: Admin, BondClient, etc. with permissions
│   │   ├── enrichment/
│   │   │   ├── registry.js        Enrichment provider registry
│   │   │   └── utils.js           Enrichment utilities
│   │   └── [utilities]
│   │
│   ├── services/
│   │   ├── messaging.js           Email/SMS messaging service
│   │   └── [domain services]
│   │
│   └── middleware/
│       ├── errorHandler.js        Error handling
│       └── [other middleware]
│
└── [config files]
```

**Key Concepts**:
- **Direct Collection Queries**: `routes/cases.js` reads from `simple_harris`, `simple_jefferson`, etc. directly, **not** from a `cases` collection.
- **Models**: Mongoose models like `Case`, `Message`, `CaseAudit` store **metadata** (CRM details, messages, enrichment results), not the raw case data.
- **Aggregation**: The GET `/api/cases` endpoint builds MongoDB aggregation pipelines against the source collections.
- **Roles-Based Access Control**: `lib/roles.js` defines permissions; `routes/utils/authz.js` enforces them.

### `/scripts/` — Utility & Seed Scripts

```
/scripts/
├── seed-test-data.js              Generate test data
├── analyze_har.mjs                Analyze HTTP archives
├── atlas_*.py                     MongoDB Atlas audit scripts
├── eval_windows.py                Window evaluation script
└── [other utilities]
```

**Purpose**: Helper scripts for development, testing, and data analysis. Not part of the main application.

### `/backups/` — Component Backups

```
/backups/
├── CaseDetail_step*.jsx           Historical versions of CaseDetail
├── Cases_step*.jsx                Historical versions of Cases
└── [other component versions]
```

**Purpose**: Archive of previous component implementations. Used for reference during refactors.

### `/docs/` — Documentation

```
/docs/
├── SYSTEM_ARCHITECTURE.md         ← You are here
├── authentication-integration.md   Auth flow & Firebase integration
├── deployment-containerization.md  Docker & Render.io deployment
├── cicd-staging.md                CI/CD pipeline info
├── checkins-integration-plan.md    Check-ins feature
├── payments-*.md                  Payment integration docs
├── CRM_SUBVIEWS*.md               CRM feature details
├── Enrichment_Wiring_Status.md     Enrichment system status
├── progress/                       Session-by-session progress notes
└── changes/                        Change logs & diffs
```

**Purpose**: Comprehensive documentation of system architecture, features, integration points, and deployment.

### `/nginx/` — Web Server Config

```
/nginx/
└── default.conf                   Nginx configuration for static web serving
```

**Purpose**: Nginx reverse proxy config (used in production on Render.io).

---

## Key Technologies & Versions

### Frontend
- **React**: 19.x (latest)
- **React Router**: 7.8.2
- **Vite**: 7 (build tool)
- **TanStack Query (React Query)**: 5.87.x (async data fetching & caching)
- **Radix UI**: Component library
- **lucide-react**: Icon library
- **Tailwind CSS**: Utility-first styling

### Backend
- **Node.js**: 20.x (Alpine)
- **Express**: 4.x
- **Mongoose**: 7.x (MongoDB ODM)
- **Firebase Admin SDK**: For token verification
- **MongoDB**: Atlas cloud (dev & prod)

### DevOps
- **Docker**: Multi-stage builds, hotreload profile for dev
- **Docker Compose**: Orchestrates web, api, mongo, redis, mailhog locally
- **Render.io**: Production deployment platform

---

## API Endpoints Summary

### Cases

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/cases` | List cases (county, filters, sorting) |
| GET | `/api/cases/:id` | Single case detail |
| GET | `/api/cases/stats` | Case statistics (count by county, stage, etc.) |
| PATCH | `/api/cases/:id` | Update CRM fields (stage, notes, assignedTo, etc.) |
| GET | `/api/cases/:id/messages` | Case messages/communication |
| GET | `/api/cases/:id/activity` | Case activity/audit log |
| POST | `/api/cases/:id/audit` | Add case audit entry |

### Dashboard

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/dashboard/kpis` | Key performance indicators |
| GET | `/api/dashboard/trends` | Trend data (7d, 30d, etc.) |
| GET | `/api/dashboard/top` | Top 10 cases (by bond, etc.) |
| GET | `/api/dashboard/new` | Recently booked cases |
| GET | `/api/dashboard/recent` | Recently updated cases |
| GET | `/api/dashboard/per-county` | Stats per county |

### Enrichment

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/enrichment/providers` | List enrichment providers |
| POST | `/api/enrichment/:providerId/run` | Run enrichment on a case |
| GET | `/api/enrichment/:providerId/results/:caseId` | Enrichment results |

### Auth

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login with email/password |
| GET | `/api/auth/session` | Current user session |
| POST | `/api/auth/logout` | Logout |

---

## Database Collections

### County Data (Source Collections)

- **`simple_harris`**: 13,459 Harris County inmate records
- **`simple_jefferson`**: 661 Jefferson County inmate records
- **`simple_brazoria`**: 3,140 Brazoria County inmate records
- **`simple_galveston`**: 5,455 Galveston County inmate records
- **`simple_fortbend`**: 858 Fort Bend County inmate records

**Schema** (normalized):
```javascript
{
  _id: ObjectId,
  full_name: String,
  first_name: String,
  last_name: String,
  county: String,
  dob: String (YYYY-MM-DD),
  agency: String,
  facility: String,
  booking_date: String (YYYY-MM-DD),
  booking_number: String,
  case_number: String,
  spn: String,
  offense: String,
  charge: String,
  status: String,
  bond_amount: Number,
  bond_label: String,
  phone_nbr1: String,
  phone_nbr2: String,
  phone_nbr3: String,
  race: String,
  sex: String,
  createdAt: Date,
  updatedAt: Date,
  // ... many more fields
}
```

### Metadata Collections (Stored Separately)

- **`users`**: 10 user accounts (Firebase UID, roles, permissions)
- **`caseaudits`**: 67 audit log entries
- **`caseenrichments`**: 17 enrichment cache entries
- **`messages`**: 7 messages/communication records
- **`inquiries`**: 32 inquiry/support tickets
- **`reports`**: 65 report definitions
- **`jobs`**: Job queue entries
- **`enrichment_jobs`**: 2,111 enrichment job records

---

## Development Workflow

### Local Development

```bash
# 1. Start Docker Compose (hotreload stack)
docker compose -f docker-compose.dev.yml --profile hotreload up -d

# 2. Access services
# Web:  http://localhost:5175 (Vite dev server)
# API:  http://localhost:8080 (Express server)
# Mongo: mongodb://localhost:27018/warrantdb
# Redis: localhost:6381
# Mail: http://localhost:8025 (MailHog)

# 3. Code changes auto-reload
#    - Web: Vite HMR (hot module reload)
#    - API: nodemon watches src/ directory
```

### Deployment (Render.io)

```
feature/prospects-and-crm-ui branch
    ↓
Push to GitHub
    ↓
Render detects deploy/production push event
    ↓
Deploy via render.yaml:
  - warrantdb-web: Static web app (Vite build → Nginx)
  - warrantdb-api: Docker API (Express + Mongoose)
    ↓
Live at https://warrantdb.onrender.com
```

---

## Current Status (Dec 8, 2025)

✅ **Completed**:
- Firebase Auth integration
- Docker dev stack (web, api, mongo, redis, mailhog)
- Case list & detail pages with CRM fields
- Dashboard with KPIs, trends, stats
- DOB and SPN fields added to UI
- Phone numbers (phone_nbr1, phone_nbr2, phone_nbr3) added
- Prospects page created (high-bond, recent cases)
- User role-based access control (RBAC)
- API routes now query county collections directly (Dec 8)

⚠️ **In Progress**:
- Enrichment API integration (endpoints stubbed, not wired to actual enrichment service)
- CaseDetail enrichment panel UI
- DOB sweep mutation workflow
- Subject summary display

📋 **Planned**:
- Enrichment provider registry completion
- Messaging system integration
- Payment processing integration
- Advanced reporting & analytics

---

## Troubleshooting

### API Returns 500 on `/api/cases`

**Cause**: User doesn't have `dashboard:read` or `cases:read` permission.

**Fix**:
1. Check user roles in `db.users.findOne()`: should include `['Admin']` or role with `cases:read` permission.
2. If needed, update via MongoDB: `db.users.updateOne({...}, {$set: {roles: ['Admin']}})`
3. Restart API: `docker restart bail-bonds-dashboard-api-dev-1`

### Web App Shows Blank Screen

**Cause**: Firebase config not loaded (missing `<script src="/env.js"></script>` in index.html).

**Fix**:
1. Check index.html has: `<script src="/env.js"></script>` before `<script type="module" src="/src/main.jsx"></script>`
2. Check `/public/env.js` has Firebase credentials.
3. Hard refresh browser (Cmd+Shift+R).

### API Can't Connect to MongoDB

**Cause**: MONGO_URI env var pointing to wrong host or credentials invalid.

**Check**:
1. Docker Compose: `docker compose ps` → mongo service running?
2. Env var: `echo $MONGO_URI` in api-dev container
3. MongoDB Atlas: Verify IP whitelist includes Docker container's IP (or use 0.0.0.0/0 for dev)

---

## Next Steps

1. **Wire Enrichment API**: Connect `useProspects`, `useRunDobSweepMutation`, `useSubjectSummary` hooks to actual enrichment service endpoints.
2. **Implement DOB Sweep**: Allow users to run DOB sweep on prospects and apply results to CRM.
3. **Subject Summary Panel**: Display enrichment results (Pipl profile, arrest history) in CaseDetail.
4. **Test Full Flow**: End-to-end test from case discovery → enrichment → CRM apply.
5. **Documentation**: Update this guide as features complete.

