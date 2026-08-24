# Warrant System — Engineering Handoff

**Prepared:** 2026-08-24
**Audience:** A new developer or engineering team picking up this codebase.
**Companion docs:** `Warrant-System-Audit-and-Plan.md` (full audit history, read this for *why* decisions were made), `docs/architecture/OVERVIEW.md` (topology reference), `README.md` (quick start).

---

## 1. What this system is

**Vintaragroup's bail bonds SaaS.** It scrapes county jail booking data across several Texas counties, enriches it with identity/contact data, and gives bail bond agents a dashboard to manage cases, communicate with clients (SMS/voice via Telnyx), and track check-ins. A Telnyx-powered AI phone agent ("Tiffany") also answers inbound calls and can look up custody status directly against the database.

The system is **one real product that currently runs across two separate GitHub organizations of repos**:

1. **`warrant-system`** (this repo) — a monorepo created 2026-04-24, consolidating three previously-separate repos. This is the **active source of truth**; all engineering work since that date happens here.
2. **`AI_Agent_Warrant`** — a separate, still-standalone repo running the live Telnyx phone agent. It was never merged into the monorepo, though a byte-identical copy of its code now also lives in `warrant-system/services/ai-agent` for reference/future consolidation. **The real phone number still deploys from the standalone repo, not this one** — see §6.

Three other repos (`bail-bonds-UI-app`, `warrantdb-pipeline`, `inmate_enrichment`) are frozen/superseded originals, kept around only as history. Do not build on them.

---

## 2. Getting access

You'll need accounts/credentials for:

| System | What it's for | Who to ask |
|---|---|---|
| **GitHub** — `Vintaragroup/warrant-system` | The monorepo | repo owner |
| **GitHub** — `Vintaragroup/AI_Agent_Warrant` | Still the live phone-agent deploy source (§6) | repo owner |
| **MongoDB Atlas** | Production database (`warrantdb` cluster, cluster name `warrantsystem.ricp2it.mongodb.net`) | team lead — get a scoped user, don't share the admin connection string |
| **Render** (`Derrick's workspace`) | Hosts the dashboard backend, pipeline, and AI agent | team lead |
| **Vercel** (`Ryan Morrow's projects` team) | Hosts the dashboard frontend | team lead |
| **Telnyx** | Messaging (SMS) + the AI voice assistant | team lead |
| **AWS** | S3 (check-in photos, future mugshot uploads) | team lead |
| **Pipl / Whitepages (Ekata)** | Enrichment data providers — **both currently non-functional**, see §7 | team lead |
| **Google Cloud Console** | OAuth client for "Sign in with Google" on the dashboard | team lead |

### Cloning and first run

```bash
git clone https://github.com/Vintaragroup/warrant-system.git
cd warrant-system
npm install                       # installs all npm workspaces (apps/*, services/*, packages/*)

cp .env.example .env              # fill in real values — see table below
npm run stack:up                  # docker compose: spins up Mongo + Redis for every service

# Then, per service:
cd apps/dashboard && npm run dev              # Vite frontend, http://localhost:5173
cd apps/dashboard && npm run server:dev       # Express API, http://localhost:8080
cd apps/dashboard/server && npm run create-local-user   # bootstrap your own admin login

cd services/inmate-enrichment && npm run stack:up        # Express API + BullMQ worker
cd services/warrantdb-pipeline && uvicorn api.main:app --reload   # FastAPI, needs a Python venv + requirements.txt
cd services/ai-agent && uvicorn app.main:app --reload --port 8080
```

Two of the four services are Python (`warrantdb-pipeline`, `ai-agent`) — each has its own `requirements.txt`; the two JS services (`apps/dashboard`, `services/inmate-enrichment`) are npm workspaces, installed by the single root `npm install`.

**Env files:** every service has a `.env.example` (and the repo root has one too, for the consolidated Docker Compose stack). **Do not point local dev at production Atlas** — each service's `docker-compose.yml` hardcodes a local Mongo target for exactly this reason (a local script once nearly wrote test data into real production before this was fixed — see `Warrant-System-Audit-and-Plan.md` §3.5). If you genuinely need to read production for a one-off diagnostic, each service keeps a **gitignored** `.env.atlas` backup with real Atlas credentials — ask the team lead, don't recreate it from scratch, and never point a service's normal dev startup at it.

**Auth:** the dashboard uses **self-hosted Passport.js** (email/password + Google OAuth, sessions in Mongo/Redis) — not Firebase, not a third-party auth SaaS. See `apps/dashboard/server/src/lib/passport.js`. This was migrated off Firebase Auth on 2026-08-22.

---

## 3. Architecture

```
warrant-system/
├── apps/dashboard/          React/Vite frontend + Express API backend
│                             Frontend → Vercel · Backend → Render (Docker)
│                             Messaging: Telnyx (migrated off Twilio 2026-08-23)
│
├── services/
│   ├── warrantdb-pipeline/  Python/FastAPI county scrapers → MongoDB
│   │                        Deployment: Render (1 web service + 5 per-county crons)
│   │
│   ├── inmate-enrichment/   TypeScript: Express API + BullMQ worker
│   │                        Enriches scraped records via Pipl/Whitepages
│   │                        Deployment: self-hosted / Docker Compose only — not on Render
│   │
│   └── ai-agent/            Telnyx voice/SMS agent (FastAPI)
│                             Deployment: Render — but see §6, deploys from a
│                             different repo than the code living here
│
└── packages/                shared-schema, shared-config — stubs, not yet implemented
```

**Data flow:**

```
warrantdb-pipeline scrapers → MongoDB (warrantdb, simple_*/v2_* collections)
        ↓
inmate-enrichment watcher → BullMQ → Pipl/Whitepages → subjects collection
        ↓
apps/dashboard reads simple_*/v2_* (cases) + subjects (enrichment) + crm_overlays (CRM state)
        ↓
React frontend
```

**Databases** (MongoDB Atlas, one cluster, several logical databases):

| Service | Database | Key collections |
|---|---|---|
| `warrantdb-pipeline` | `warrantdb` | `simple_*` (legacy per-county), `v2_*` (current per-county staging — this is what the dashboard actually displays) |
| `dashboard` | `warrantdb` (shared with pipeline) | `users`, `case_enrichment`, `check_ins`, `messages`, `payments`, `crm_overlays` |
| `inmate-enrichment` | `inmate_enrichment` | `subjects`, `raw_payloads`, `related_parties` |
| `ai-agent` | `ai_agent` (deliberately separate — see below) | `persons`, `custody_events`, `inquiries`, `callback_queue` |

Why `ai-agent` is on its own database: its `checkins`/`cases` collection names would collide with the dashboard's `check_ins`/`cases` if merged onto `warrantdb`. Its code has a fast-path lookup that *would* read `simple_*`/`v2_*` from whatever database it's pointed at, but on its own separate database those collections don't exist — so today that's a graceful no-op, not live cross-service access.

**`crm_overlays`** (new, added 2026-08-23) is worth understanding specifically: it's an app-owned collection holding all CRM state (stage, tags, notes) for a case, keyed by the case's own raw `_id`, deliberately decoupled from the pipeline's `simple_*`/`v2_*` documents so that a re-scrape can never silently clobber CRM data. See `apps/dashboard/server/src/models/CrmOverlay.js` and `.../routes/utils/caseAccess.js`. This exists to fix a real bug — see §7.

Full topology, port map, and Render-file-to-service mapping: `docs/architecture/OVERVIEW.md` (note: its Render Deployments table is stale as of this handoff — it still describes the pre-2026-08-24 setup; §5 below is current).

---

## 4. Current deployed state (as of 2026-08-24)

The system was deliberately suspended on Render for a period while this consolidation work happened, then brought back up starting 2026-08-24 — **rebuilt to deploy from `warrant-system`, not the old standalone repos**, wherever that's been completed so far.

| Service | Platform | Status | Deploys from |
|---|---|---|---|
| `warrantdb-api` (dashboard backend) | Render (Docker, Starter) | 🟢 Live, healthy | `warrant-system` / `main` — **done** |
| Dashboard frontend | Vercel | 🔴 **Blocked** — Vercel's GitHub App isn't authorized for this repo; project creation fails silently. Needs someone with GitHub org admin to grant access, then retry. | `warrant-system` / `main`, once unblocked |
| Pipeline (`warrant-api` + 5 county crons) | Render | 🔴 **Not yet deployed** from `warrant-system` — still running from the old `warrantdb-pipeline` standalone repo | pending Blueprint deploy from `infra/render/pipeline.render.yaml` |
| `ai-agent-warrant` (live phone number) | Render | 🟢 Live, working | `AI_Agent_Warrant` (standalone repo) — **not** `warrant-system`, see §6 |
| `warrant-pipeline` (old worker) | Render | 🟢 Running but does nothing (`sleep infinity`) | old `warrantdb-pipeline` repo — candidate for deletion |
| `warrantdb-pipeline` (old cron), `bail-bonds-UI-app` (old frontend) | Render | ⏸ Suspended | old repos — candidates for deletion once the above land |

**What's actually verified working end-to-end** (real browser/API tests, not just "it deployed"): dashboard login, case list/detail with real scraped data, CRM writes (tags/stage/notes) across all counties, document/enrichment routes, the Telnyx AI agent's `find_person`/`get_bail_status`/`transfer_plan` tools against real data.

**What's not yet verified on the *new* Render deployment specifically**: a real login + CRM write against `warrantdb-api`'s new deployment (it's healthy but hasn't had a full click-through pass since repointing); the pipeline crons haven't run at all yet from `warrant-system` (still pending deploy).

---

## 5. Known issues / open items

Ranked roughly by severity:

1. **The live phone number doesn't deploy from this monorepo.** `ai-agent-warrant.onrender.com` (the real, called number) deploys from the standalone `AI_Agent_Warrant` repo. `warrant-system/services/ai-agent` is a manually-kept-in-sync copy. Two real production bugs this session each needed the identical fix applied in both places by hand — a live, recurring risk of drift. Repointing this to deploy from `warrant-system` should be a near-term priority, not a nice-to-have.
2. **Pipeline data is stale.** The scraper pipeline had zero ingestion runs of any kind between 2026-05-20 and this rebuild — roughly 3 months dormant, traced to the Render cron jobs never having been correctly deployed. The 5-cron setup in `infra/render/pipeline.render.yaml` is believed correct but hasn't gone live yet (§4). Until it does, `v2_*` data is frozen at ~2026-05-01.
3. **Galveston scraper: connection reset.** `p2c.galvestoncountytx.gov` (and its alternate hostname) resets the TLS connection with no response — looks like a real outage of the county's own backend, not IP blocking. Worth a retest; if still down, this is a courtesy report to the Sheriff's office IT, not an engineering fix.
4. **Brazoria scraper: blocked by AWS WAF Bot Control.** `portal-txbrazoria.tylertech.cloud` CAPTCHA-challenges every request. Not fixable in code — needs official API access or an IP allowlist exception from Brazoria County / Tyler Technologies.
5. **Both enrichment providers are dead.** Pipl's subscription expired 2025-10-29. Whitepages' API domain no longer resolves (likely dead post-acquisition by Ekata/Mastercard). Enrichment code itself works (verified against real data before providers failed) — this needs an account-level fix: renew Pipl, or integrate a replacement provider.
6. **Telnyx AI assistant voice is a stopgap.** The original ElevenLabs voice integration silently failed ("could not generate the greeting audio") for every call from 2026-07-29 until diagnosed 2026-08-23 — the assistant answered and immediately hung up, with no alerting to catch it. Currently running on a Telnyx-native voice as a working fix; the ElevenLabs integration's root cause was never found (not diagnosable from outside Telnyx's platform). If ElevenLabs quality/features are wanted back, that needs a real investigation, ideally with Telnyx support.
7. **No monitoring/alerting anywhere in this system.** Both the greeting-audio outage and the 3-month pipeline dormancy were discovered by a user manually noticing something was wrong, not by any automated signal. See §8.
8. **MFA enrollment UI looks like a non-wired stub.** `apps/dashboard/src/components/auth/MFAEnrollment.tsx` has `const secret: string | null = null;` with a comment noting the secret must come from the server — but no server call is wired in. Before enabling/advertising MFA to users, confirm whether this flow is actually functional end-to-end. (Note: the *old* `bail-bonds-UI-app` repo had a real, since-fixed vulnerability here — a hardcoded, identical-for-every-user TOTP secret. That fix is not needed in this repo; the code here was already written correctly. This is a functionality gap, not a repeat of that vulnerability.)
9. **A real GCP service-account key is committed to git** in the unrelated `warrentscrapingdb` repo (`credentials.json`, private but not scrubbed). Rotate the key and scrub it from history.
10. **CRM overlay migration hasn't been run against production.** `apps/dashboard/server/scripts/migrate_crm_to_overlay.js` (dry-run by default) backfills any historical CRM data from the legacy `simple_harris`/`simple_jefferson` subset into the new `crm_overlays` collection. Purely additive and safe to run anytime, but hasn't been run yet.
11. **Scoped (non-global) test-user access wasn't re-verified** against the case-access scoping fix that shipped alongside the CRM overlay work — worth a manual QA pass.

---

## 6. Final phases to close the loop

### Immediate (infrastructure rebuild, in progress)
- [ ] Get Vercel's GitHub App authorized for `Vintaragroup/warrant-system`, then finish the frontend deploy (project creation, `VITE_API_URL`).
- [ ] Set the dashboard backend's `WEB_ORIGIN` to the real Vercel URL once it exists (required for CORS + cross-origin cookies).
- [ ] Deploy the pipeline Blueprint (`infra/render/pipeline.render.yaml`) from `warrant-system` — creates the web service + 5 county crons; set real `MONGO_URI` on each.
- [ ] Full end-to-end verification pass on the *new* deployments: real login, real case data, real CRM write, one real cron-triggered scrape landing in Atlas.
- [ ] Once verified: decommission the old suspended/vestigial Render services (`warrantdb-api`-old, `bail-bonds-UI-app`, `warrantdb-pipeline`-old-cron, `warrant-pipeline`-worker) — get explicit sign-off before deleting anything.

### Phase 4 remainder (messaging/CRM polish)
- [ ] Get real `TELNYX_MESSAGING_FROM_NUMBER` / `TELNYX_MESSAGING_PROFILE_ID` / `TELNYX_PUBLIC_KEY`, confirm the webhook signature format against a real captured payload, and point the Telnyx Messaging Profile's webhooks at `/api/messages/telnyx/status` and `/api/messages/telnyx/inbound`.
- [ ] Finish check-in reminders/GPS queue (tracked separately in `final-feature-readiness.md`).
- [ ] Build the "add mugshot/photo" upload feature for clients — pre-decided to use S3 (mirroring `services/ai-agent`'s existing pattern), not local disk (doesn't survive a Render redeploy). No longer blocked — the case-write bug that used to block it is fixed.

### Phase 5 (consolidation cleanup)
- [ ] Repoint `ai-agent-warrant` to deploy from `warrant-system` (see §5.1 — the highest-value item here).
- [ ] Extract genuinely shared fields into `packages/shared-schema` (currently a stub).
- [ ] Standardize env var naming across services (`MONGO_DB` vs `MONGO_DB_NAME`, proxy URL naming, etc.)
- [ ] Rotate/scrub the committed GCP key in `warrentscrapingdb` (§5.9), then archive that repo.
- [ ] Run the `crm_overlays` migration script against production.
- [ ] Do the scoped-test-user QA pass on case-access scoping.

### External / non-engineering blockers
- [ ] Brazoria: pursue official API access or a WAF allowlist exception.
- [ ] Renew Pipl, or select and integrate a replacement for Whitepages.
- [ ] Confirm whether the Twilio A2P 10DLC campaign status still matters now that messaging has moved to Telnyx (possibly moot).

---

## 7. Suggested improvements & additions

A few things worth doing that go beyond "finish the plan," based on patterns visible across this whole audit:

1. **Add CI.** There is currently no `.github/workflows` at all — no automated lint, test, or build check on PRs, across any of the four services. Even a minimal workflow (npm test + eslint for the JS services, a smoke import for the Python ones) would have caught real regressions faster than the manual live-testing this project has relied on so far.
2. **Add health/freshness monitoring, not just health checks.** The pipeline went silently dormant for ~3 months and a live phone line silently failed on every call for ~3 weeks, both discovered by manual chance rather than any automated signal. A simple "last successful ingestion run per source" and "last successful Telnyx call" check with alerting (even just a daily Slack/email digest) would close a real, demonstrated gap. This matters more than most feature work at this system's current stage.
3. **Consolidate to one deploy source per service, permanently.** The `ai-agent` split (§5.1) isn't a one-time cleanup item — it's a structural risk as long as it exists, since it silently doubles the work (and doubles the chance of a missed fix) for every future bug in that service.
4. **Centralize secrets instead of ad-hoc `.env`/`.env.atlas` handoffs.** Real credentials (Mongo connection strings, Telnyx API keys, Render API tokens) have been passed around this project via chat and gitignored local backup files. That's workable for a small team short-term, but doesn't scale and has no audit trail. Render's env groups (shareable across services) or a real secrets manager (1Password, Doppler, etc.) would remove an entire category of "who has the current key" friction.
5. **Expand test coverage.** As of this handoff there are exactly 3 small test suites (`cases.crm_enrichment`, `payments.refund`, `payments.routes`), all in `apps/dashboard/server`. `services/warrantdb-pipeline` and `services/ai-agent` (both Python, both handling real money-adjacent and legally-sensitive data) have none visible. Given how much of this project's actual bug history has been "the write path silently only worked for one county," route-level and model-binding tests would have caught several of the bugs documented in §5 and in `Warrant-System-Audit-and-Plan.md` before they reached production.
6. **Fix `docs/architecture/OVERVIEW.md`'s Render Deployments table** — it still describes the pre-rebuild service layout (a static-site frontend on Render, the vestigial worker). Cheap, but currently actively misleading for anyone using it as a reference.
7. **Decide the enrichment provider question deliberately, not reactively.** With both current providers dead for unrelated reasons, this is a natural point to evaluate 2-3 alternatives against actual data needs rather than defaulting back to the same vendor relationships.
8. **Formalize `packages/shared-schema`.** It's referenced by the architecture docs as the long-term answer to schema drift between the pipeline and the dashboard (the `booking_date`/bond-amount coercion bugs documented in `docs/architecture/schema-contract.md` are exactly the class of bug this would prevent going forward), but it's still an empty stub.

---

## 8. Where to look for more detail

- `Warrant-System-Audit-and-Plan.md` — the full narrative history: every finding, decision, and fix from the consolidation audit through this handoff, in chronological phases. This is the primary source this handoff was distilled from.
- `docs/architecture/OVERVIEW.md` — topology, data flow, database/port reference.
- `docs/architecture/consolidation-decisions.md` — indexed architectural decisions with rationale, plus what was explicitly *rejected* and why.
- `docs/architecture/mongo-strategy.md`, `schema-contract.md`, `env-strategy.md` — the specific technical contracts referenced above.
- `MIGRATION_PLAN.md` — source-to-target file mapping from the original consolidation.
- `docs/audits/` — 36 detailed per-service audit files from the pre-migration audit cycle.
