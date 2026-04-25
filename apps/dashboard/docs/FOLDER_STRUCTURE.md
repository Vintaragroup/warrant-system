# Folder Structure Reference

A comprehensive guide to the Bail Bonds Dashboard repository structure, identifying active folders vs. legacy/backup areas.

---

## Quick Reference: Which Folders Matter?

| Folder | Status | Purpose | Start Here? |
|--------|--------|---------|------------|
| `/src` | 🟢 ACTIVE | React frontend code (components, pages, hooks) | ✅ YES |
| `/server/src` | 🟢 ACTIVE | Node.js/Express backend (routes, models, middleware) | ✅ YES |
| `/public` | 🟢 ACTIVE | Static assets & runtime config (env.js is critical) | ✅ YES |
| `/docs` | 🟢 ACTIVE | Architecture & deployment documentation | ✅ YES |
| `/nginx` | 🟢 ACTIVE | Web server configuration (Render.io) | ⚠️ Production only |
| `/scripts` | 🟡 UTILITY | Development helper scripts | ❌ Not required |
| `/backups` | 🔴 LEGACY | Historical component versions (archive only) | ❌ Don't use |
| `/docker-compose*.yml` | 🟢 ACTIVE | Docker orchestration files | ✅ Local dev |

---

## Detailed Folder Map

### 🟢 ACTIVE: `/src` — React Frontend

**Location**: `/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/src/`

```
src/
├── main.jsx                       Entry point (React 19, CRA omitted for Vite)
├── App.jsx                        Router wrapper, main layout
├── App.css                        Global styles
├── index.css                      Additional global CSS
├── firebaseClient.ts              Firebase SDK initialization
│
├── pages/                         Route-level components
│   ├── Dashboard.jsx              Main dashboard (stats, KPIs, charts)
│   ├── Cases.jsx                  Case list with filters & sorting
│   ├── CaseDetail.jsx             Single case view (CRM, documents, activity)
│   ├── Prospects.jsx              High-bond prospects discovery
│   ├── Reports.jsx                Analytics & reporting
│   ├── Settings.jsx               User settings
│   ├── Auth.jsx                   Login/registration page
│   └── CRM.jsx                    CRM workspace
│
├── components/                    Reusable UI components
│   ├── [40+ component files]      Radix UI + custom components
│   │
│   ├── DataTable.jsx              Generic table component (cases list, reports)
│   ├── CaseCard.jsx               Case summary card
│   ├── CaseMiniCard.jsx           Mini case preview
│   ├── ChartCard.jsx              Chart wrapper with title/legend
│   ├── CRMPopover.jsx             CRM field editor (inline)
│   │
│   ├── dashboard/                 Dashboard subcomponents
│   │   ├── KPICard.jsx            KPI display (count, trend, icon)
│   │   ├── TrendChart.jsx         Line chart (7d, 30d trends)
│   │   ├── TopCases.jsx           Top 10 cases by bond
│   │   └── ...
│   │
│   ├── case/                      Case detail subcomponents
│   │   ├── CaseHeader.jsx         Case title & status
│   │   ├── CaseFields.jsx         Demographic fields (DOB, sex, race)
│   │   ├── CRMFields.jsx          CRM-editable fields (stage, notes, etc.)
│   │   ├── DocumentsTab.jsx       Documents/attachments list
│   │   ├── ActivityTab.jsx        Activity log/timeline
│   │   ├── EnrichmentPanel.jsx    Enrichment results (Pipl, DOB sweep)
│   │   └── ...
│   │
│   ├── enrichment/                Enrichment UI components
│   │   ├── SubjectSummary.jsx     Pipl profile display
│   │   ├── EnrichmentResults.jsx  DOB sweep results table
│   │   ├── RunEnrichmentButton.jsx Trigger enrichment mutation
│   │   └── ...
│   │
│   ├── nav/                       Navigation components
│   │   ├── Sidebar.jsx            Left sidebar (nav, user, settings)
│   │   ├── TopNav.jsx             Top navigation bar
│   │   └── BreadcrumbNav.jsx      Breadcrumb trail
│   │
│   ├── ui/                        Radix UI + shadcn/ui wraps
│   │   ├── Button.jsx
│   │   ├── Dialog.jsx
│   │   ├── Select.jsx
│   │   ├── Input.jsx
│   │   └── [20+ UI elements]
│   │
│   └── [other components]
│
├── hooks/                         Custom React hooks (TanStack Query, auth, etc.)
│   │
│   ├── cases.js                   Case data queries
│   │   ├── useCase(id)            Single case
│   │   ├── useCases(opts)         Case list (county, filters, sort)
│   │   ├── useCaseMeta()          Case metadata
│   │   ├── useUpdateCase()        Mutation: update CRM fields
│   │   └── ...
│   │
│   ├── dashboard.js               Dashboard queries
│   │   ├── useKPIs()              Key performance indicators
│   │   ├── useTrends()            Trend data (7d, 30d)
│   │   ├── useTopCases()          Top 10 by bond/date
│   │   ├── useRecentCases()       Recently booked/updated
│   │   └── ...
│   │
│   ├── enrichment.js              Enrichment API hooks (STUBS)
│   │   ├── useProspects()         High-bond prospect list
│   │   ├── useRunDobSweepMutation() DOB sweep mutation (not wired)
│   │   ├── useSubjectSummary()    Pipl profile query (not wired)
│   │   └── ...
│   │
│   ├── messages.js                Messaging hooks
│   │   ├── useMessages()          Message list for a case
│   │   ├── useSendMessage()       Send message mutation
│   │   └── ...
│   │
│   ├── useAuth.ts                 Firebase auth context
│   │   ├── useUser()              Current user
│   │   ├── useLogout()            Logout mutation
│   │   └── ...
│   │
│   ├── usePersistedState.js       Persist state to localStorage
│   ├── useDebounce.js             Debounce hook
│   └── [other utility hooks]
│
├── lib/                           Utility functions & clients
│   │
│   ├── api.js                     HTTP client (fetch wrapper)
│   │   ├── setAuthToken()         Inject Firebase JWT
│   │   ├── apiFetch(url, opts)    Wrapper with auth, error handling
│   │   └── ...
│   │
│   ├── firebaseClient.ts          Firebase SDK init
│   │   ├── initializeApp()        Set up Firebase (reads window.__ENV__)
│   │   ├── auth, db               Exported auth & firestore instances
│   │   └── ...
│   │
│   ├── formatters.js              Format utilities
│   │   ├── formatCurrency()       $1,234.56
│   │   ├── formatDate()           MM/DD/YYYY
│   │   ├── formatPhoneNumber()    (XXX) XXX-XXXX
│   │   └── ...
│   │
│   ├── validators.js              Input validation
│   │   ├── isValidPhoneNumber()
│   │   ├── isValidEmail()
│   │   └── ...
│   │
│   └── constants.js               App-wide constants
│       ├── BOND_STAGES            CRM stage options
│       ├── CASE_STATUSES          Case status options
│       ├── API_URL                Backend base URL
│       └── ...
│
├── layouts/                       Layout wrapper components
│   ├── AppLayout.jsx              Main app layout (sidebar + content)
│   └── AuthLayout.jsx             Auth pages layout
│
├── styles/                        CSS & styling
│   ├── global.css                 Global resets
│   ├── tailwind.css               Tailwind directives
│   └── [component styles]
│
├── types/                         TypeScript type definitions
│   ├── case.ts                    Case type definitions
│   ├── user.ts                    User type definitions
│   └── ...
│
└── utils/                         General utilities
    ├── api.ts                     API response helpers
    ├── auth.ts                    Auth utilities
    └── ...
```

**Key Files to Know**:
1. **`firebaseClient.ts`**: Initializes Firebase Auth. Must run after `window.__ENV__` is set.
2. **`lib/api.js`**: HTTP client that attaches Firebase JWT to all requests.
3. **`hooks/cases.js`**: Core data-fetching hooks. Used by Cases.jsx and CaseDetail.jsx.
4. **`pages/CaseDetail.jsx`**: Largest component (~1000 lines). Tabs: overview, CRM, documents, activity, enrichment.
5. **`hooks/enrichment.js`**: Stubs for enrichment features (DOB sweep, Pipl integration). Not yet connected to backend.

---

### 🟢 ACTIVE: `/server/src` — Node.js Backend

**Location**: `/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/server/src/`

```
server/src/
├── index.js                       Express app entry point
├── openapi.yaml                   OpenAPI/Swagger specification
│
├── models/                        Mongoose schemas & models
│   ├── Case.js                    Case metadata model (NOT the source data)
│   ├── CaseAudit.js               Audit log entries
│   ├── CaseEnrichment.js          Enrichment results cache
│   ├── Message.js                 Messages/communication
│   ├── User.js                    User account & roles
│   ├── Report.js                  Report definitions
│   ├── Job.js                     Job queue entries
│   └── EnrichmentJob.js           Enrichment job history
│
├── routes/                        Express route handlers
│   │
│   ├── cases.js                   **KEY FILE** (just updated Dec 8)
│   │   ├── GET /api/cases         Query county collections directly
│   │   ├── GET /api/cases/:id     Single case (queries simple_* collections)
│   │   ├── GET /api/cases/stats   Statistics (count per county, stage, etc.)
│   │   ├── PATCH /api/cases/:id   Update CRM fields (stage, notes, assignedTo, etc.)
│   │   ├── GET /api/cases/:id/messages
│   │   ├── GET /api/cases/:id/activity
│   │   ├── POST /api/cases/:id/audit
│   │   └── ... (more endpoints)
│   │
│   ├── dashboard.js               Dashboard aggregates
│   │   ├── GET /api/dashboard/kpis        Key performance indicators
│   │   ├── GET /api/dashboard/trends      Trend data (7d, 30d)
│   │   ├── GET /api/dashboard/top         Top 10 by bond
│   │   ├── GET /api/dashboard/new         Recently booked
│   │   ├── GET /api/dashboard/recent      Recently updated
│   │   ├── GET /api/dashboard/per-county  Per-county stats
│   │   └── ...
│   │
│   ├── enrichment.js              Enrichment service proxy
│   │   ├── GET /api/enrichment/providers       List providers
│   │   ├── POST /api/enrichment/:providerId/run   Run enrichment on a case
│   │   ├── GET /api/enrichment/results/:caseId
│   │   └── ... (enrichment endpoints)
│   │
│   ├── auth.js                    Authentication
│   │   ├── POST /api/auth/register   Register user
│   │   ├── POST /api/auth/login      Email/password login
│   │   ├── GET /api/auth/session     Current user session
│   │   ├── POST /api/auth/logout     Logout
│   │   └── ...
│   │
│   ├── messages.js                Messaging
│   │   ├── GET /api/messages       List messages
│   │   ├── POST /api/messages      Send message
│   │   └── ...
│   │
│   ├── reports.js                 Reporting
│   │   ├── GET /api/reports        List reports
│   │   ├── GET /api/reports/:id    Single report
│   │   └── ...
│   │
│   └── [other routes]
│
├── middleware/                    Express middleware
│   ├── auth.js                    Verify Firebase JWT token
│   ├── authz.js                   Role-based authorization (ensurePermission)
│   ├── errorHandler.js            Global error handler
│   ├── logger.js                  Request logging
│   └── ...
│
├── lib/                           Shared utilities & services
│   │
│   ├── roles.js                   **RBAC Definitions**
│   │   ├── ROLES                  Role definitions (Admin, BondClient, etc.)
│   │   ├── permissions            Permission mappings (dashboard:read, cases:read, etc.)
│   │   └── hasPermission()        Check if role has permission
│   │
│   ├── enrichment/                Enrichment system
│   │   ├── registry.js            Provider registry
│   │   ├── utils.js               Enrichment utilities
│   │   └── handlers/              Provider-specific handlers
│   │
│   ├── db.js                      MongoDB connection utilities
│   ├── validate.js                Input validation schemas
│   └── ...
│
├── services/                      Domain services
│   ├── messaging.js               Email/SMS service
│   ├── audit.js                   Audit log service
│   ├── enrichment.js              Enrichment orchestration
│   └── ...
│
├── utils/                         General utilities
│   ├── logger.js                  Logging helper
│   ├── errors.js                  Custom error classes
│   └── ...
│
├── config/                        Configuration
│   ├── database.js                MongoDB connection
│   ├── firebase.js                Firebase Admin SDK init
│   └── ...
│
└── constants/                     App constants
    ├── counties.js                County list & mappings
    └── ...
```

**Key Files to Know**:
1. **`routes/cases.js`**: Core cases endpoint (just updated Dec 8 to query county collections directly).
2. **`lib/roles.js`**: RBAC definitions. Admin has all permissions; BondClient has limited.
3. **`models/User.js`**: User schema with roles array (default: ['Admin'] as of Dec 8).
4. **`middleware/authz.js`**: `ensurePermission('dashboard:read')` style gating.
5. **`lib/enrichment/registry.js`**: Enrichment provider registry (Pipl, DOB sweep, etc.).

---

### 🟢 ACTIVE: `/public` — Static Assets & Runtime Config

**Location**: `/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/public/`

```
public/
├── env.js                         🔴 CRITICAL: Runtime Firebase config
│                                  Loaded by <script src="/env.js"></script>
│                                  in index.html before app init
│
├── env.example.js                 Template for env.js
│                                  Copy & update with your Firebase credentials
│
├── [favicon, images, static assets]
```

**`env.js` Example**:
```javascript
window.__ENV__ = {
  VITE_FIREBASE_API_KEY: "AIzaSy...",
  VITE_FIREBASE_AUTH_DOMAIN: "warrantdb.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "warrantdb",
  VITE_FIREBASE_APP_ID: "1:123:web:456",
  VITE_FIREBASE_MEASUREMENT_ID: "G-ABC123",
  VITE_API_URL: "http://localhost:8080",
  VITE_NODE_ENV: "development"
};
```

**⚠️ Critical**: Without this, `firebaseClient.ts` will fail during initialization.

---

### 🟢 ACTIVE: `/docs` — Documentation

**Location**: `/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/docs/`

```
docs/
├── SYSTEM_ARCHITECTURE.md         ← NEW: Overall system design & data flow
├── FOLDER_STRUCTURE.md            ← NEW: This file
│
├── authentication-integration.md   Firebase Auth + custom auth layer
├── deployment-containerization.md  Docker & Render.io setup
├── cicd-staging.md                CI/CD pipeline
├── checkins-integration-plan.md    Check-ins feature plan
│
├── messaging-sms-integration.md    SMS/messaging system
├── payments-*.md                  Payment integration details
├── messaging-provider-brief.md    Messaging providers overview
│
├── CRM_SUBVIEWS.md                CRM feature architecture
├── CRM_SUBVIEWS_COMPLETION.md     CRM completion checklist
├── Enrichment_Wiring_Status.md    Enrichment system status
│
├── production-deployment.md        Production checklist
├── Release_Smoke_Checklist.md      Pre-release QA
│
├── progress/                       Session-by-session notes
│   └── [dated notes]
│
├── changes/                        Change logs & diffs
│   └── [diff files]
│
├── credentials/                    Credentials documentation
│   ├── requested_creds.md         Credentials mapping
│   └── requested_creds.example.md Template
│
├── auth-ui-integration-review.md   Auth UI review
└── final-feature-readiness.md      Feature completeness checklist
```

**Key Docs**:
1. **`SYSTEM_ARCHITECTURE.md`**: Start here for understanding the system.
2. **`authentication-integration.md`**: Firebase + custom auth details.
3. **`Enrichment_Wiring_Status.md`**: Current enrichment feature status.

---

### 🟡 UTILITY: `/scripts` — Development Helpers

**Location**: `/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/scripts/`

```
scripts/
├── seed-test-data.js              Generate test data for dev
├── analyze_har.mjs                Analyze HTTP archives (network requests)
├── sanitize_har.mjs               Remove sensitive data from HAR files
│
├── atlas_*.py                     MongoDB Atlas audit scripts
│   ├── atlas_fieldmap_diff.py     Field mapping comparison
│   ├── atlas_simple_audit.py      Audit simple_* collections
│   ├── atlas_categorical_field_audit.py   Categorical fields check
│   └── atlas_source_audit.py      Source collection audit
│
├── eval_windows.py                Evaluate time windows (for prospects)
└── debug_reports/                 Debug output folder
```

**Use Case**: Not required for development. Used for data analysis, debugging, testing.

---

### 🔴 LEGACY: `/backups` — Component Archives

**Location**: `/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/backups/`

```
backups/
├── CaseDetail_step*.jsx           Historical CaseDetail versions
├── Cases_step*.jsx                Historical Cases page versions
├── Dashboard_step*.jsx            Historical Dashboard versions
├── CaseActionsPopover_step*.jsx   Historical CRM popover versions
│
├── hooks_cases_step*.js           Historical hooks versions
│
├── server_case_model_step*.js     Historical Case model versions
├── server_cases_step*.js          Historical cases route versions
├── server_documents_step*.js      Historical documents route versions
│
└── Reports_step*.jsx              Historical Reports page versions
```

**⚠️ Do NOT use**: These are archives from previous development iterations. Reference only if debugging historical issues. All active code is in `/src` and `/server/src`.

---

### 🟢 ACTIVE: Docker & Deployment Files

**Location**: Root directory

```
Root/
├── docker-compose.dev.yml         Dev stack (web, api, mongo, redis, mailhog)
├── docker-compose.override.yml    Environment variable overrides
├── docker-compose.staging.yml     Staging environment compose
│
├── Dockerfile.web                 Vite build → Nginx (web layer)
├── server/Dockerfile              Node.js + Express (API layer)
│
├── render.yaml                    Render.io deployment config
├── nginx/default.conf             Nginx reverse proxy config
│
├── package.json                   Frontend dependencies
├── server/package.json            Backend dependencies
│
├── tsconfig.json                  TypeScript config
├── vite.config.js                 Vite build config
├── vitest.config.ts               Vitest test runner config
│
└── index.html                     SPA entry point (loads env.js before app)
```

---

## Quick Navigation Guide

### For Frontend Development

Start here:
1. **Component**: `/src/pages/` or `/src/components/`
2. **Styling**: Use Tailwind CSS classes; global styles in `/src/styles/`
3. **Data fetching**: Use hooks from `/src/hooks/` (useCase, useCases, etc.)
4. **Types**: Check `/src/types/` for TypeScript definitions
5. **API calls**: Use `lib/api.js` fetch wrapper (automatically injects auth)

### For Backend Development

Start here:
1. **Route**: `/server/src/routes/`
2. **Model**: `/server/src/models/`
3. **Middleware**: `/server/src/middleware/` (auth, authz, error handling)
4. **Business logic**: `/server/src/services/` or `/server/src/lib/`
5. **Roles/permissions**: `/server/src/lib/roles.js`

### For Database

Start here:
1. **County data**: MongoDB collections `simple_harris`, `simple_jefferson`, etc.
2. **Metadata**: Collections `users`, `caseaudits`, `messages`, etc.
3. **Schema**: Defined in `/server/src/models/`
4. **Audit scripts**: `/scripts/atlas_*.py`

### For DevOps

Start here:
1. **Local dev**: `docker-compose.dev.yml`
2. **Secrets**: `/public/env.js`
3. **Production**: `render.yaml` + `nginx/default.conf`
4. **Docs**: `/docs/deployment-containerization.md`

---

## Common Tasks

### "Where do I add a new page?"
1. Create component in `/src/pages/YourPage.jsx`
2. Add route in `/src/App.jsx` (React Router)
3. Add nav link in `/src/components/nav/Sidebar.jsx`
4. Create corresponding hooks in `/src/hooks/yourpage.js` if needed

### "Where do I add a new API endpoint?"
1. Create route handler in `/server/src/routes/newroute.js`
2. Add to Express app in `/server/src/index.js`
3. Import `ensurePermission` middleware if protected
4. Create React hook in `/src/hooks/newroute.js` to call endpoint

### "Where do I query the county data?"
→ `/server/src/routes/cases.js` shows the pattern (uses `db.collection('simple_harris')` directly, not Mongoose `Case` model).

### "Where do I store sensitive config?"
→ `/public/env.js` (loaded at runtime before app init).

### "Where do I update user roles?"
→ `/server/src/models/User.js` (schema) + `/server/src/lib/roles.js` (permission definitions) + MongoDB console.

---

## File Size Reference

```
/src                     ~50 files, 1.2 MB
/server/src              ~30 files, 800 KB
/docs                    ~20 files, 2 MB
/backups                 ~15 files, 600 KB (archive)
/scripts                 ~10 files, 200 KB (utilities)
```

---

## Summary Table: What's Active?

| Layer | Location | Status | Purpose |
|-------|----------|--------|---------|
| **Frontend** | `/src/` | 🟢 ACTIVE | React app code |
| **Backend** | `/server/src/` | 🟢 ACTIVE | Express API code |
| **Config** | `/public/`, root files | 🟢 ACTIVE | Environment & build config |
| **Infra** | `docker-compose*.yml`, `Dockerfile*` | 🟢 ACTIVE | Docker orchestration |
| **Docs** | `/docs/` | 🟢 ACTIVE | Architecture & deployment |
| **Scripts** | `/scripts/` | 🟡 UTILITY | Dev helpers (not required) |
| **Backups** | `/backups/` | 🔴 LEGACY | Archive only |

