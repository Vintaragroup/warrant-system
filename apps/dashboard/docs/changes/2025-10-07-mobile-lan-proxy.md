# 2025-10-07 — Mobile LAN dev: same-origin proxy

Summary of changes to make iOS/Android testing over LAN reliable by ensuring first‑party session cookies via Vite's dev proxy.

## Why
- iOS often restricts third‑party cookies; cross‑origin API calls led to 401 on `/api/auth/me` after login.
- Using same‑origin `/api` from the SPA makes `Set-Cookie` first‑party.

## Changes
- `vite.config.js`
  - Server proxy for `/api` now points to `process.env.VITE_PROXY_API_TARGET || 'http://localhost:8080'`.
- `docker-compose.dev.yml`
  - `web-dev` environment: `VITE_API_URL=/api` (browser calls same origin)
  - `web-dev` environment: `VITE_PROXY_API_TARGET=http://api-dev:8080` (Vite forwards to API service)
- Client: no code changes required beyond using `API_BASE` that defaults to `/api`.

## How to use
- Start the dev stack with hotreload profile.
- On your phone, browse to `http://<mac-ip>:5173` and sign in.
- API calls go to `/api` (same origin), Vite forwards to API container.

## Rollback
- Set `VITE_API_URL_DEV` to a full URL (e.g., `http://<mac-ip>:8080/api`) and omit `VITE_PROXY_API_TARGET`.
- In that mode, cookies become cross‑site and may be blocked on iOS.

## Notes
- Keep `WEB_ORIGIN` in the API set to include the web origin (LAN IP + port) for CORS; though with same‑origin, most CORS flows are avoided.
- Stripe.js will warn about HTTP in dev; ignore or enable HTTPS with Vite if needed.
