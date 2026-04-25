# Data Flow Architecture

A comprehensive guide showing how information moves through the system from raw data → database → API → frontend → user interface.

---

## Table of Contents
1. [High-Level Overview](#high-level-overview)
2. [Connection Flow & Environment Controls](#connection-flow--environment-controls)
3. [Data Sources & Ingestion](#data-sources--ingestion)
4. [API Request/Response Flows](#api-requestresponse-flows)
5. [Frontend Data Fetching](#frontend-data-fetching)
6. [Real-Time & Caching](#real-time--caching)
7. [Authentication & Authorization](#authentication--authorization)
8. [Enrichment Data Flow](#enrichment-data-flow)
9. [CRM Updates Flow](#crm-updates-flow)

---

## High-Level Overview

```
┌─────────────────────┐
│  County Jail        │
│  Systems            │
└──────────┬──────────┘
           │ (raw records)
           ▼
┌─────────────────────────────┐
│  External Normalizer        │
│  (produces JSON/CSV)        │
└──────────┬──────────────────┘
           │ (normalized fields)
           ▼
┌────────────────────────────────────────────────┐
│  MongoDB Atlas Cloud                           │
│  ├── simple_harris (13,459 docs)               │
│  ├── simple_jefferson (661 docs)               │
│  ├── simple_brazoria (3,140 docs)              │
│  ├── simple_galveston (5,455 docs)             │
│  ├── simple_fortbend (858 docs)                │
│  └── [Metadata collections: users, messages]   │
└────────┬─────────────────────────────────────┘
         │ (native MongoDB queries)
         ▼
┌────────────────────────────┐
│  Express.js API Server     │
│  (localhost:8080)          │
│  ├── GET /api/cases        │
│  ├── GET /api/dashboard/*  │
│  └── PATCH /api/cases/:id  │
└────────┬───────────────────┘
         │ (JSON over HTTP)
         ▼
┌────────────────────────────────────┐
│  React Frontend (Vite Dev Server)  │
│  (localhost:5175)                  │
│  ├── useCases() hook               │
│  ├── useKPIs() hook                │
│  └── Cases.jsx, Dashboard.jsx      │
└────────┬───────────────────────────┘
         │ (rendered HTML/CSS)
         ▼
┌────────────────────────────┐
│  Browser / End User        │
│  (Chrome, Safari, Firefox) │
└────────────────────────────┘
```

---

## Connection Flow & Environment Controls

This section documents the exact wiring between the browser, the Vite dev server, the Express API, and MongoDB Atlas so future local changes cannot silently fall back to the empty dockerized Mongo instance.

### Local dev stack (docker compose `web-dev` + `api-dev`)

```
Browser (https://localhost:5175)
  │
  ▼  HTTPS (optional) / HTTP requests from React app
Vite dev server (`web-dev` service)
  │  - Serves `/src` assets
  │  - Proxies `/api/*` to `http://api-dev:8080` via `VITE_PROXY_API_TARGET`
  ▼
Express API (`api-dev` service running server/src/index.js)
  │  - Uses `dotenv` to load `.env` (repo root) and `server/.env`
  │  - Establishes a single `mongoose` connection during boot
  ▼
MongoDB Atlas (`warrentsystem.ricp2it.mongodb.net`, db `warrantdb`)
```

- `src/lib/api.js` resolves `API_BASE` in this order: runtime `window.__ENV__.VITE_API_URL` → build-time `import.meta.env.VITE_API_URL` → `/api`. In compose, `web-dev` sets `VITE_PROXY_API_TARGET=http://api-dev:8080`, so every frontend fetch automatically lands on the containerized API.
- Frontend auth headers are Firebase ID tokens (when available) plus the first-party session cookie, so switching between environments does not require code changes.

### Environment resolution inside the API

- `server/src/config/loadEnv.js` executes before any route handlers are registered. It loads **two** files, in order:
  1. Repository-level `.env`
  2. `server/.env`
- Later files win. That means production secrets (Atlas URI, Redis, OAuth) should live in `server/.env`. The compose file intentionally **does not** set `MONGO_URI` or `MONGO_DB`; leaving them empty ensures the values from `server/.env` flow through to `process.env` even when docker is started without additional flags.
- Any change to Atlas credentials only requires editing `server/.env` and restarting `api`/`api-dev`.

### Quick verification commands (use after any compose restart)

From the repo root:

```bash
# 1. Ensure containers are running
docker compose -f docker-compose.dev.yml up -d api-dev web-dev

# 2. Confirm the API sees the Atlas URI
docker exec bail-bonds-dashboard-api-dev-1 node -e "const dotenv=require('dotenv');
dotenv.config({path:'/app/.env'});
console.log(process.env.MONGO_URI);"

# 3. Spot-check a collection count to prove Atlas has data
docker exec bail-bonds-dashboard-api-dev-1 node -e "const dotenv=require('dotenv');
dotenv.config({path:'/app/.env'});
const mongoose=require('mongoose');
(async()=>{await mongoose.connect(process.env.MONGO_URI,{dbName:'warrantdb'});
const count=await mongoose.connection.collection('simple_harris').countDocuments();
console.log('simple_harris count:', count);
process.exit(0);})();"
```

If step 2 prints `mongodb://mongo:27017`, the container is still pointing at the local mongo service. Fix by checking `server/.env` exists and re-run compose after removing any overriding `MONGO_URI` shell export.

### Recovery playbook when the frontend shows empty data

1. **Check Atlas connectivity**: run the commands above; expect a non-zero document count.
2. **Restart `api-dev` cleanly**: `docker compose -f docker-compose.dev.yml restart api-dev`. The service re-runs `npm run dev`, reloading env files.
3. **Verify Vite proxy target**: `docker compose logs -f web-dev` should show `VITE_PROXY_API_TARGET=http://api-dev:8080`. If the frontend was started outside compose, ensure `.env` (root) sets `VITE_PROXY_API_TARGET=http://localhost:8080` or update `src/lib/api.js` runtime env via `public/env.js`.
4. **Validate browser requests**: open DevTools → Network → filter by `/api`. Requests should hit `http://localhost:5175/api/...` and receive `200`. If you see `404` from `/api/cases/by-case-number/*`, re-run the Atlas lookup script or query the route directly using `curl --head -H "Authorization: Bearer <token>" http://localhost:5175/api/cases/by-case-number/<identifier>`.

Following this checklist guarantees the React tabs (Dashboard, Prospects, Cases) stay hydrated from Atlas instead of the empty docker mongo volume.

---

## Data Sources & Ingestion

### Phase 1: Raw Data → County Collections

```
Timeline: External process (not part of this codebase)

Step 1: Extract
  County Jail System (Harris County, Jefferson County, etc.)
    → API or SFTP export
    → Raw record files (JSON, CSV, XML)

Step 2: Transform/Normalize
  External Normalizer Process
    → Maps field names (JailDB.inmate_name → full_name)
    → Validates data types (booking_date to YYYY-MM-DD)
    → Removes PII if needed
    → Outputs normalized JSON

Step 3: Load
  MongoDB Connection
    → Insert/update simple_harris collection
    → Insert/update simple_jefferson collection
    → ... (repeat for all counties)

Result: Live MongoDB collections with current inmate data
```

### Data Schema (Normalized)

All county collections follow this schema:

```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439011"),
  
  // Identity Fields
  full_name: "JOHN SMITH",
  first_name: "JOHN",
  last_name: "SMITH",
  dob: "1985-03-15",
  ssn: "XXX-XX-1234", // May be hashed or absent
  spn: "123456789", // State Personal Number
  
  // Location Fields
  county: "HARRIS",
  agency: "HARRIS COUNTY JAIL",
  facility: "HCSO MAIN JAIL",
  
  // Booking Fields
  booking_date: "2025-01-15",
  booking_number: "2025-0123456",
  case_number: "2025-CR-0123456",
  
  // Physical Description
  sex: "M",
  race: "WHITE",
  height_ft: 5,
  height_in: 10,
  weight_lb: 180,
  
  // Contact
  phone_nbr1: "7135551234",
  phone_nbr2: "7135555678",
  phone_nbr3: null,
  
  // Charges & Bail
  offense: "ASSAULT - BODILY INJURY",
  charge: "ASSAULT",
  charge_grade: "MISDEMEANOR",
  bond_amount: 5000,
  bond_label: "PERSONAL RECOGNIZANCE",
  bond_type: "PR BOND",
  status: "ACTIVE", // or RELEASED, CONVICTED, etc.
  
  // Metadata
  createdAt: ISODate("2025-01-15T10:30:00.000Z"),
  updatedAt: ISODate("2025-01-15T10:30:00.000Z"),
  
  // ... 50+ additional fields specific to county systems
}
```

### Collection Statistics (Dec 8, 2025)

| County | Collection | Doc Count | Last Updated |
|--------|-----------|-----------|--------------|
| Harris | `simple_harris` | 13,459 | 2025-01-15 |
| Jefferson | `simple_jefferson` | 661 | 2025-01-14 |
| Brazoria | `simple_brazoria` | 3,140 | 2025-01-15 |
| Galveston | `simple_galveston` | 5,455 | 2025-01-15 |
| Fort Bend | `simple_fortbend` | 858 | 2025-01-14 |
| **TOTAL** | | **23,573** | |

---

## API Request/Response Flows

### 1. GET /api/cases — Fetch Case List

```
User Action: Click "Cases" page → Load case list

Frontend:
  useCases({
    county: 'harris',
    minBond: 5000,
    window: '24h',
    limit: 25,
    sort: '-bond_amount'
  })

HTTP Request:
  GET /api/cases?county=harris&minBond=5000&window=24h&limit=25&sort=-bond_amount
  Headers: {
    Authorization: "Bearer <firebase-jwt>"
  }

Backend (server/src/routes/cases.js):
  1. Verify JWT token (middleware/auth.js)
  2. Check permission: ensurePermission('cases:read')
  3. Extract query params
  4. Calculate filter:
     - county: 'harris' → collection: 'simple_harris'
     - minBond: 5000 → filter: { bond_amount: { $gte: 5000 } }
     - window: '24h' → filter: { booking_date: { $gte: <24h ago> } }
  5. Build MongoDB aggregation pipeline:
     $match: { bond_amount: { $gte: 5000 }, booking_date: { $gte: ... } }
     $sort: { bond_amount: -1 }
     $project: { full_name, dob, bond_amount, spn, ... }
     $limit: 25
  6. Execute: db.collection('simple_harris').aggregate([...]).toArray()
  7. Get totalCount from aggregation

Response (JSON):
  {
    data: [
      {
        _id: "507f...",
        full_name: "JOHN SMITH",
        dob: "1985-03-15",
        bond_amount: 15000,
        spn: "123456789",
        booking_date: "2025-01-15",
        case_number: "2025-CR-0123456",
        phone_nbr1: "7135551234",
        status: "ACTIVE",
        ... (25 records)
      }
    ],
    totalCount: 342,
    limit: 25,
    offset: 0
  }

Frontend (React):
  1. TanStack Query caches response with key: ['cases', { county: 'harris', ... }]
  2. Render Cases.jsx with data
  3. Display table: 25 rows × columns (name, DOB, bond, spn, phone, status)
  4. Show pagination: "1-25 of 342 results"
```

### 2. GET /api/cases/:id — Fetch Single Case

```
User Action: Click on a case row → Navigate to detail page

Frontend:
  useCase(caseId)

HTTP Request:
  GET /api/cases/507f1f77bcf86cd799439011
  Headers: { Authorization: "Bearer <jwt>" }

Backend:
  1. Extract county from caseId document (query all collections until found)
  2. Query collection: db.collection(county).findOne({ _id: ObjectId(caseId) })
  3. Enrich with metadata:
     - Query Case model for CRM data (stage, notes, assignedTo)
     - Query CaseAudit model for activity log
     - Query Message model for communications
     - Query CaseEnrichment model for enrichment results

Response:
  {
    case: {
      _id: "507f...",
      full_name: "JOHN SMITH",
      dob: "1985-03-15",
      ... (all 50+ fields)
    },
    crm: {
      stage: "INITIAL_CONTACT", // User-editable
      notes: "High priority case",
      assignedTo: "agent@example.com",
      tags: ["high-bond", "recent"]
    },
    activity: [
      { type: 'CREATED', timestamp: '...', user: '...' },
      { type: 'CRM_UPDATED', timestamp: '...', user: '...' }
    ],
    messages: [
      { id: '...', type: 'email', sent: '...', content: '...' }
    ],
    enrichment: {
      pipl: { ... }, // Subject summary
      dobSweep: [ ... ] // DOB sweep results
    }
  }

Frontend (React):
  Render CaseDetail.jsx with tabs:
  - Overview: Demographics
  - CRM: Editable fields (stage, notes, assignedTo)
  - Documents: Attachments
  - Activity: Timeline
  - Enrichment: Pipl profile, DOB sweep
```

### 3. PATCH /api/cases/:id — Update CRM Fields

```
User Action: Change case stage from "INITIAL_CONTACT" to "NEGOTIATION"

Frontend:
  useUpdateCase(caseId).mutate({
    stage: "NEGOTIATION",
    notes: "Negotiating bond reduction..."
  })

HTTP Request:
  PATCH /api/cases/507f1f77bcf86cd799439011
  Headers: {
    Authorization: "Bearer <jwt>",
    Content-Type: "application/json"
  }
  Body: {
    stage: "NEGOTIATION",
    notes: "Negotiating bond reduction..."
  }

Backend:
  1. Verify JWT, check permission: 'cases:update'
  2. Validate input (stage must be in BOND_STAGES enum)
  3. Update Case model: Case.findByIdAndUpdate(caseId, { stage, notes }, { new: true })
  4. Create audit entry: CaseAudit.create({ caseId, type: 'CRM_UPDATED', ... })

Response:
  {
    case: { _id: '...', full_name: '...', ... },
    crm: { stage: 'NEGOTIATION', notes: 'Negotiating bond...', ... },
    activity: [ ... ] // Updated with new entry
  }

Frontend:
  1. TanStack Query invalidates ['case', caseId] key
  2. Re-fetch case details
  3. UI updates to show new stage
```

### 4. GET /api/dashboard/kpis — Fetch Dashboard Stats

```
User Action: Load Dashboard page

Frontend:
  useKPIs()

HTTP Request:
  GET /api/dashboard/kpis
  Headers: { Authorization: "Bearer <jwt>" }

Backend (server/src/routes/dashboard.js):
  Aggregates across ALL county collections using $unionWith:
  
  1. Query simple_harris:
     $match: { status: 'ACTIVE' }
     $group: { _id: null, count: { $sum: 1 }, avgBond: { $avg: 'bond_amount' } }
  
  2. Query simple_jefferson (union results)
  3. Query simple_brazoria (union results)
  ... (all counties)
  
  4. Combine & aggregate:
     totalActiveCases: 23,573
     avgBondAmount: 12,450
     totalBondValue: 294,567,890
     recentBookings: 847 (last 24h)
     etc.

Response:
  {
    totalActiveCases: 23573,
    avgBondAmount: 12450,
    totalBondValue: 294567890,
    recentBookings: 847,
    byCounty: {
      harris: { count: 13459, avgBond: 13200 },
      jefferson: { count: 661, avgBond: 8500 },
      ... (all counties)
    }
  }

Frontend:
  Render Dashboard.jsx KPI cards with metrics
```

---

## Frontend Data Fetching

### TanStack Query (React Query) Pattern

```javascript
// src/hooks/cases.js

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

// Query: Fetch cases list
export function useCases(options = {}) {
  return useQuery({
    queryKey: ['cases', options],  // Cache key
    queryFn: async () => {
      const params = new URLSearchParams(options);
      const res = await apiFetch(`/api/cases?${params}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,  // 5 minutes
    gcTime: 30 * 60 * 1000,    // 30 minutes (garbage collect)
    retry: 2,
    refetchInterval: 30000,     // Refetch every 30 seconds
  });
}

// Query: Fetch single case
export function useCase(id) {
  return useQuery({
    queryKey: ['case', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/cases/${id}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

// Mutation: Update case
export function useUpdateCase() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const res = await apiFetch(`/api/cases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: (data) => {
      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: ['case', data._id] });
      queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}
```

### Component Usage

```javascript
// src/pages/Cases.jsx

import { useCases } from '../hooks/cases';

export default function Cases() {
  const [filters, setFilters] = useState({
    county: 'harris',
    minBond: 5000,
  });
  
  // Fetch cases with filters
  const { data, isLoading, error } = useCases(filters);
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <div>
      <h1>Cases ({data.totalCount})</h1>
      <DataTable rows={data.data} columns={[...]} />
      <Pagination total={data.totalCount} limit={data.limit} />
    </div>
  );
}
```

### Cache Invalidation

When data changes (via mutation):

```
User updates case stage
  ↓
useUpdateCase().mutate({ stage: 'NEGOTIATION' })
  ↓
Mutation succeeds
  ↓
queryClient.invalidateQueries({ queryKey: ['case', id] })
queryClient.invalidateQueries({ queryKey: ['cases'] })
  ↓
TanStack Query marks cache as "stale"
  ↓
Next render triggers re-fetch
  ↓
API returns fresh data
  ↓
UI updates
```

---

## Real-Time & Caching

### Cache Strategy

```
Stale Time: 5 minutes
  After 5 min, data marked as "stale" but not discarded
  Next query triggers background refetch

Garbage Collection: 30 minutes
  After 30 min of no access, cache entry deleted

Refetch Interval: 30 seconds
  Automatically refetch in background every 30s

Manual Invalidation: On mutation
  After PATCH /api/cases/:id, invalidate ['case', id] and ['cases']
```

### Real-Time Updates (Optional Future)

Currently: Polling via `refetchInterval: 30000`

Future enhancement: WebSocket
```javascript
// Concept (not implemented yet)
useEffect(() => {
  const ws = new WebSocket('ws://localhost:8080/api/cases/stream');
  ws.onmessage = (event) => {
    const updated = JSON.parse(event.data);
    queryClient.setQueryData(['case', updated.id], updated);
  };
}, []);
```

---

## Authentication & Authorization

### Firebase Auth Flow

```
Step 1: User logs in (Auth.jsx)
  Email: user@example.com
  Password: ****
    ↓
Firebase Auth SDK (firebaseClient.ts)
  firebase.auth().signInWithEmailAndPassword(email, password)
    ↓
Firebase Returns:
  {
    user: { uid: 'abc123...', email: 'user@example.com' },
    idToken: 'eyJ...' (JWT token)
  }
    ↓
Store in app context (useAuth hook)
  window.currentUser = user

Step 2: Every API request
  api.js fetch wrapper:
  - Get idToken from firebase.auth().currentUser.getIdToken()
  - Inject header: Authorization: "Bearer <idToken>"
  - Send request

Step 3: Backend verifies token
  middleware/auth.js:
  - Extract token from Authorization header
  - Call firebase.auth().verifyIdToken(token)
  - Attach user info to req.user
  - Next middleware

Step 4: Check permissions
  middleware/authz.js:
  - Get user from req.user
  - Query User model to get roles: ['Admin']
  - Check if role has permission:
    ensurePermission('cases:read')(req, res, next)
  - If yes: continue; if no: 403 Forbidden

Step 5: Process request normally
  routes/cases.js handler executes
```

### Role-Based Access Control

```javascript
// lib/roles.js

const ROLES = {
  Admin: {
    permissions: [
      'dashboard:read',
      'cases:read',
      'cases:update',
      'cases:delete',
      'enrichment:run',
      'users:manage',
    ]
  },
  BondClient: {
    permissions: [
      'cases:read:self',  // Can only see own cases
      'cases:update:self',
    ]
  },
};

// middleware/authz.js
export function ensurePermission(permission) {
  return async (req, res, next) => {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    const hasPermission = user.roles.some(role =>
      ROLES[role]?.permissions.includes(permission)
    );
    
    if (!hasPermission) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    next();
  };
}
```

---

## Enrichment Data Flow

### Current Status: Stubs Only (Not Wired)

The enrichment hooks exist but don't connect to actual service.

```
Frontend:
  useProspects()
  useRunDobSweepMutation()
  useSubjectSummary()
    ↓
  Not implemented (return mock data)

Expected Flow (when wired):
  Click "Run Enrichment" button
    ↓
  useRunDobSweepMutation().mutate({ caseId, dob, firstName, lastName })
    ↓
  POST /api/enrichment/dob-sweep/run
    ↓
  Backend (server/src/routes/enrichment.js):
    POST body: { caseId, dob, firstName, lastName }
    → Call enrichment API (localhost:4000)
    → GET /enrichment/v1/dob-sweep?dob=...&name=...
    → Store results in CaseEnrichment model
    → Return results
    ↓
  Response:
    {
      results: [
        { name: 'John Smith', dob: '1985-03-15', ssn: 'XXX-XX-1234', ... },
        ...
      ]
    }
    ↓
  Frontend:
    Display results in EnrichmentPanel.jsx
    Show "Apply to CRM" button
    User confirms → Update CaseDetail with enrichment data
```

### Enrichment Provider Registry

```javascript
// server/src/lib/enrichment/registry.js

const PROVIDERS = {
  pipl: {
    name: 'Pipl',
    endpoints: {
      subjectSummary: '/enrichment/v1/subject-summary',
    },
    baseUrl: process.env.ENRICHMENT_API_URL || 'http://localhost:4000',
  },
  dobSweep: {
    name: 'DOB Sweep',
    endpoints: {
      run: '/enrichment/v1/dob-sweep',
    },
  },
};

// usage in routes/enrichment.js
export async function runEnrichment(providerId, params) {
  const provider = PROVIDERS[providerId];
  const endpoint = provider.endpoints.run;
  const url = `${provider.baseUrl}${endpoint}`;
  
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  
  return response.json();
}
```

---

## CRM Updates Flow

### Scenario: User Changes Case Stage + Notes

```
User Interface (CaseDetail.jsx):
  Stage dropdown: INITIAL_CONTACT → NEGOTIATION
  Notes field: "..." → "Negotiating bond reduction"
  Click "Save"
    ↓

Frontend (useUpdateCase mutation):
  const { mutate } = useUpdateCase();
  mutate({
    id: '507f1f77bcf86cd799439011',
    data: {
      stage: 'NEGOTIATION',
      notes: 'Negotiating bond reduction'
    }
  })
    ↓

HTTP Request:
  PATCH /api/cases/507f1f77bcf86cd799439011
  Headers: { Authorization: "Bearer <jwt>" }
  Body: { stage: 'NEGOTIATION', notes: 'Negotiating bond reduction' }
    ↓

Backend (routes/cases.js, PATCH handler):
  1. Verify JWT (middleware/auth.js)
  2. Check permission: ensurePermission('cases:update')
  3. Validate: stage must be in BOND_STAGES enum
  4. Query both:
     - County collection (simple_harris): Get original case data
     - Case model: Get existing CRM data
  5. Update Case model:
     Case.findByIdAndUpdate(caseId, {
       stage: 'NEGOTIATION',
       notes: 'Negotiating bond reduction',
       updatedAt: new Date(),
     }, { new: true })
  6. Create audit entry:
     CaseAudit.create({
       caseId,
       type: 'CRM_UPDATED',
       changes: {
         stage: { old: 'INITIAL_CONTACT', new: 'NEGOTIATION' },
         notes: { old: '...', new: 'Negotiating...' }
       },
       changedBy: req.user.uid,
       timestamp: new Date()
     })
  7. Return updated case with CRM data + activity log
    ↓

Response:
  {
    case: { _id: '...', full_name: '...', dob: '...', ... },
    crm: {
      stage: 'NEGOTIATION',
      notes: 'Negotiating bond reduction',
      updatedAt: '2025-01-15T14:30:00Z'
    },
    activity: [
      { type: 'CRM_UPDATED', timestamp: '2025-01-15T14:30:00Z', user: '...', changes: {...} },
      ...
    ]
  }
    ↓

Frontend (React):
  1. Mutation succeeds
  2. queryClient.invalidateQueries(['case', caseId])
  3. useCase hook re-fetches
  4. CaseDetail.jsx re-renders with new stage/notes
  5. Activity log shows new entry
  6. UI confirms: "Case updated"
    ↓

User sees:
  ✓ Stage changed to "NEGOTIATION"
  ✓ Notes updated
  ✓ Activity log shows "CRM updated by [user]"
  ✓ Timestamp shows when changed
```

---

## Summary Diagram: Complete Information Flow

```
County Jail System (external)
    │
    ├─ Harris County Jail API
    ├─ Jefferson County Jail API
    └─ (other counties)
    │
    ▼ (raw records)
    
External Normalizer Process
    │ (parses, transforms, validates)
    ▼
    
MongoDB Atlas (Cloud)
    ├─ simple_harris (13,459 docs)
    ├─ simple_jefferson (661 docs)
    ├─ simple_brazoria (3,140 docs)
    ├─ simple_galveston (5,455 docs)
    └─ simple_fortbend (858 docs)
    │ (plus: users, caseaudits, messages, enrichments)
    │
    ▼ (MongoDB queries: aggregation, find)
    
Express.js API Server (8080)
    ├─ routes/cases.js (reads county collections)
    ├─ routes/dashboard.js (aggregates multi-county)
    ├─ routes/enrichment.js (proxies to enrichment API)
    └─ middleware/auth.js, middleware/authz.js (JWT, RBAC)
    │ (HTTP JSON responses)
    ▼
    
React Frontend (5175)
    ├─ hooks/cases.js (TanStack Query)
    ├─ hooks/dashboard.js
    ├─ hooks/enrichment.js
    └─ pages/, components/ (UI render)
    │ (user interactions)
    ▼
    
Browser / End User
    └─ Views dashboard, case list, case detail
        Updates CRM fields, runs enrichment
```

---

## Performance Considerations

### Database Queries

- **County collections**: Indexed on `booking_date`, `bond_amount`, `status` for fast filters
- **Case model**: Indexed on `caseId` and `createdAt`
- **Aggregation**: Limits to 25-100 results per county to avoid large transfers

### Frontend Caching

- **TanStack Query**: 5-minute stale time, 30-minute garbage collection
- **Re-fetches**: 30-second interval for dashboard (more frequent = more load)
- **Manual invalidation**: After mutations (update CRM fields)

### API Response Sizes

- **GET /api/cases**: ~150 KB (25 cases × 50 fields)
- **GET /api/cases/:id**: ~30 KB (full case + metadata)
- **GET /api/dashboard/kpis**: ~5 KB (aggregated stats)

---

## Key Data Transformation Points

1. **Raw → County Collections**: External normalizer (not in this codebase)
2. **County Collections → API Response**: MongoDB aggregation + field projection (routes/cases.js)
3. **API Response → Frontend Cache**: TanStack Query (hooks/cases.js)
4. **Frontend Cache → UI**: React components (pages/Cases.jsx, etc.)
5. **UI → User**: Browser rendering (HTML/CSS)

Each point is a potential optimization or debugging location.

