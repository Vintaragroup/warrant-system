# Dashboard ↔ Enrichment Proxy Wiring (Production + Dev)

This guide shows how to route the Bail Bonds Dashboard through a secure proxy to the Enrichment API. It covers a production-ready setup for Render.com and a local dev proxy for Vite.

Key goals:
- Keep provider keys on the enrichment service only.
- Dashboard calls proxy-safe endpoints under /ext/enrichment/*.
- Preserve score semantics and the high-quality threshold (75%).
- Support the Related Parties flows and "Re-enrich" with cooldown.

## Endpoints consumed by the dashboard

Proxy base: `/ext/enrichment` → Enrichment API base: `${ENRICHMENT_API_BASE}/api`

- GET /ext/enrichment/enrichment/subject_summary?subjectId=SPN
- GET /ext/enrichment/enrichment/related_parties?subjectId=SPN
- GET /ext/enrichment/enrichment/pipl_matches?subjectId=SPN
- POST /ext/enrichment/enrichment/related_party_pull
- Optional debugging (behind role):
  - GET /ext/enrichment/providers/pipl/raw?subjectId=SPN
  - GET /ext/enrichment/enrichment/providers

The OpenAPI lives at `${ENRICHMENT_API_BASE}/api/openapi.json` for reference.

## Production (Render.com) proxy

Recommended: run the Dashboard as a Node/Express service that serves the SPA and proxies the enrichment routes.

Environment variables (Render Dashboard service):
- ENRICHMENT_API_BASE=https://<your-enrichment-service>.onrender.com
- VITE_HIGH_QUALITY_MATCH=0.75
- (Optional) ENRICHMENT_PROXY_SECRET=<random> (see Security below)

Express skeleton (place in your dashboard repo, e.g., `server/index.ts`):

```ts
import express from 'express';
import path from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const ENRICHMENT_API_BASE = process.env.ENRICHMENT_API_BASE || 'http://localhost:4000';
const PROXY_SECRET = process.env.ENRICHMENT_PROXY_SECRET || '';

// Basic hardening for the proxy
const allowed = new Set([
  'GET /enrichment/subject_summary',
  'GET /enrichment/related_parties',
  'GET /enrichment/pipl_matches',
  'POST /enrichment/related_party_pull',
  'GET /providers/pipl/raw', // optional
  'GET /enrichment/providers', // optional
]);

app.use('/ext/enrichment', (req, res, next) => {
  const p = req.path.replace(/\/+$/, '');
  const k = `${req.method.toUpperCase()} ${p}`;
  // normalize dynamic path prefix: we only allow known base paths
  const ok = [...allowed].some((pat) => k.startsWith(pat));
  if (!ok) return res.status(404).json({ ok:false, error:'NOT_ALLOWED' });
  // Optional shared-secret header to enrichment API
  if (PROXY_SECRET) (req as any).headers['x-proxy-secret'] = PROXY_SECRET;
  next();
});

app.use(
  '/ext/enrichment',
  createProxyMiddleware({
    target: ENRICHMENT_API_BASE,
    changeOrigin: true,
    xfwd: true,
    timeout: 15000,
    proxyTimeout: 15000,
    pathRewrite: { '^/ext/enrichment': '/api' },
    onProxyReq(proxyReq) {
      // Force JSON
      proxyReq.setHeader('accept', 'application/json');
      proxyReq.setHeader('accept-encoding', 'identity');
    },
  })
);

// Serve the SPA (built assets)
const dist = path.join(process.cwd(), 'dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Dashboard listening on :${port}`));
```

Security notes:
- The allowlist prevents unexpected/expensive routes from being reachable.
- Add rate limiting (e.g., `express-rate-limit`) if the dashboard is public.
- If you enable `ENRICHMENT_PROXY_SECRET`, add a lightweight check in the Enrichment API to validate `X-Proxy-Secret` on the specific routes (optional defense-in-depth).

Render deployment:
- Create/Update a Web Service for the dashboard, build your SPA, and start with `node server/index.js` (or ts-node if using TS at runtime).
- Set env vars: ENRICHMENT_API_BASE, VITE_HIGH_QUALITY_MATCH, (optional) ENRICHMENT_PROXY_SECRET.
- Health check can use `GET /` since it serves the SPA.

## Local development (Vite) proxy

In `vite.config.ts` (dashboard repo):

```ts
export default defineConfig({
  server: {
    proxy: {
      '/ext/enrichment': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ext\/enrichment/, '/api'),
        timeout: 15000,
      },
    },
  },
});
```

Set VITE_HIGH_QUALITY_MATCH=0.75 in `.env.local` or `.env`.

## Hook contracts and score semantics

Client base: `const BASE = '/ext/enrichment';`

- useSubjectSummary(spn): `${BASE}/enrichment/subject_summary?subjectId=${spn}` → `{ ok, summary, related_parties }`
- useRelatedParties(spn): `${BASE}/enrichment/related_parties?subjectId=${spn}` → `{ ok, count, rows }`
- usePiplMatches(spn): `${BASE}/enrichment/pipl_matches?subjectId=${spn}` → `{ ok, count, rows }`
- relatedPartyPull({ subjectId, partyId, aggressive: true }): POST `${BASE}/enrichment/related_party_pull`

Display rules:
- Score formatting: if `score == null` → `—`; else show percent (`0` → `0%`, `0.78` → `78%`).
- High-quality threshold: `VITE_HIGH_QUALITY_MATCH` (default 0.75). Details prefers related parties with `accepted===true` or `match >= HQ`.
- Cooldown: use `cooldownEndsAt` from related-party rows to disable the Re-enrich button until the time passes.

## QA checklist (SPN 02865254)

- Details shows at least two high-quality related parties (e.g., includes "Lynee Marie Vela").
- Full results:
  - Provider candidates sorted by score, HQ highlighted.
  - Related parties include a mix of `0%` (pull ran, no acceptable match) and `—` (not scored).
  - Actions includes Re-enrich; cooldown disables the button and shows ETA.

## Operational references

- Enrichment API docs: `${ENRICHMENT_API_BASE}/api/docs`
- Endpoint map in this repo: `docs/API_Endpoint_Map.md`
- Related parties API details: `docs/Related_Parties_API.md`
