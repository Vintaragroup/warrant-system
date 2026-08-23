# Vintaragroup Bail Bond System — Repository Audit & Consolidation Plan

**Prepared:** August 21, 2026
**Updated:** August 22, 2026 — added Section 8 (`WarrentDB` folder audit) and Phase 0.5 after directly scanning `~/Documents/Projects2025/WarrentDB` and adjacent folders. See Section 8 for details; Sections 5 and 6 below have been amended in place where those findings sharpened an existing open question.
**Updated:** August 23, 2026 — Phases 1 and 2 completed and checked off; most of Phase 0.5 closed out (GCP key untracked from git, junk archived, clones consolidated, `Bail_bond_buddy_web_site` confirmed live and kept separate). Only the Render deploy-target confirmation remains open, deferred at the user's request.
**Updated:** August 23, 2026 (later same day) — Phase 3.5 added: a full local verification sweep (real county scraping, enrichment, frontend/CRM, Telnyx agent) done as the explicit gate before any Render rebuild. Found and fixed a real production-affecting bug along the way (case lookups only ever worked for Harris County), and a real infrastructure gap (local dev had no isolated sandbox — fixed). See Phase 3.5 for the full result and what's still genuinely blocked (externally, not by engineering work).
**Scope:** warrant-system, bail-bonds-UI-app, inmate_enrichment, warrantdb-pipeline, AI_Agent_Warrant

---

## 1. Executive Summary

You don't have five separate half-built projects — you have **one real system that forked into two active lineages**, plus **one fully-working piece that was never connected**.

- **`warrant-system`** is a monorepo created on **2026-04-24** that consolidated `bail-bonds-UI-app`, `inmate_enrichment`, and `warrantdb-pipeline` into one repo (`apps/dashboard`, `services/inmate-enrichment`, `services/warrantdb-pipeline`). Since that date, **all new work has happened inside `warrant-system`**, not the three original repos — they are effectively frozen as of the migration date.
- **`AI_Agent_Warrant`** is a mature, independently-deployed Telnyx voice/SMS agent (live at `ai-agent-warrant.onrender.com`, real call logs on disk) that was **never folded into the monorepo** and has zero references to/from it. It already reads the same `simple_*` collections the scraper pipeline writes, so it's *data-compatible* — it's just organizationally orphaned.
- The single biggest operational risk isn't missing code — it's that **production deployment likely still points at the old standalone `bail-bonds-UI-app` repo** (Render config uses manual deploys off a specific branch in that repo), while the best UI work (Scraper Ops panel, county coverage) has only been built in `warrant-system`. This needs to be verified before anything else.

**Bottom line ranking (most → least complete):**

| Rank | Repo | Verdict |
|---|---|---|
| 1 | **`warrant-system`** | Living source of truth. Keep. This is where you build going forward. |
| 2 | **`AI_Agent_Warrant`** | Fully functional, live-tested, deployed independently. Keep — but merge in. |
| 3 | **`warrantdb-pipeline`** (standalone) | Superseded by `warrant-system/services/warrantdb-pipeline`. Archive. |
| 4 | **`bail-bonds-UI-app`** (standalone) | Superseded by `warrant-system/apps/dashboard`. Archive. |
| 5 | **`inmate_enrichment`** (standalone) | Superseded by `warrant-system/services/inmate-enrichment`, AND the copy inside `warrant-system` has had only 1 commit since the migration — this is the most stagnant part of the whole system. Archive the standalone repo, but treat the enrichment *service itself* as the top priority to revive. |

---

## 2. Quick Reference Table

| Repo | First commit | Last commit | Total commits | Status |
|---|---|---|---|---|
| `AI_Agent_Warrant` | 2025-08-22 | 2026-05-01 | 79 | Active, standalone, deployed |
| `bail-bonds-UI-app` | 2025-09-10 | 2025-12-08 | 76 | Frozen — superseded |
| `inmate_enrichment` | 2025-10-18 | 2026-04-25 | 7 | Frozen — superseded |
| `warrantdb-pipeline` | 2025-08-22 | 2026-04-25 | 35 | Frozen — superseded |
| `warrant-system` | 2026-04-24 | 2026-05-01 | 31 | Active — current source of truth |

Post-migration commit activity *inside* `warrant-system`, by area:
- `services/warrantdb-pipeline/`: **25 commits** (by far the most active area — county scraper expansion, v2 staging system, scheduler)
- `apps/dashboard/`: **15 commits** (Scraper Ops panel, admin roles, bond breakdown charts)
- `services/inmate-enrichment/`: **1 commit** (the migration copy itself — nothing since)

Nobody has touched anything since **May 1, 2026** — roughly 3.5 months of inactivity as of today, across every repo.

---

## 3. Detailed Findings Per Repository

### 3.1 `warrant-system` (the monorepo — keep, build here)

Structure: `apps/dashboard/`, `services/inmate-enrichment/`, `services/warrantdb-pipeline/`, `packages/shared-schema/` (stub), `packages/shared-config/` (stub), `infra/render/*.render.yaml` (reference copies), `docs/audits/` (36 pre-migration audit docs — one full BOOT/DEPENDENCY/DOCKER/ENV/etc. audit per service, clearly AI-assisted self-audits done before the migration).

**What's genuinely working here:**
- A real **v2 staged ingestion system** for county scrapers: writes go to `v2_*` staging collections (never touching production data directly), a Mongo-backed scheduler (`scheduler/should_run.py`) enforces per-source cadence/limits, and every run (including skips) is logged to `ingestion_runs` with rich metrics (records inserted/updated/skipped, delta vs. previous run, staleness thresholds).
- Active Render cron jobs for **Galveston** (every 15 min), **Harris reports** (nightly), **Jefferson** (3x/day). **Brazoria is disabled** (unresolved network issue reaching the county site from outside the local network). **Fort Bend is manual-trigger only** by design. **Wharton County** has scraper code (`wharton_dcn.py`) but is **not yet wired into the scheduler** at all.
- A real **Scraper Operations panel** in the dashboard (2,353 lines) with live hooks into ingestion status/runs/errors/config — this replaced what used to be hardcoded mock data in the standalone dashboard repo.
- Dashboard: full CRM (cases, prospects, enrichment panel), auth (Firebase), payments (Stripe — fully wired end-to-end with tests), messaging queue (Twilio + BullMQ — **blocked on Twilio A2P 10DLC carrier approval**, not a code problem).

**Known, documented gaps (from the pre-migration audits, still relevant):**
- `warrantdb-pipeline` service: Render worker's start command is `sleep infinity` (no actual scheduled batch job runs from it — the cron jobs are separate and do the real work, so this is mostly vestigial, but worth cleaning up).
- `inmate-enrichment` service: `tools/ensure_stack.js` checks Redis readiness on `127.0.0.1:6379`, but Redis isn't published to the host in Docker Compose — the documented `npm run stack:up` path will likely time out even when the stack is actually healthy.
- `bail-bonds-dashboard` app: default containerized dev command doesn't reliably select the right Compose profile.
- No `packages/shared-schema` extraction has actually happened yet — it's a stub. The three services still each define their own Mongoose/Pydantic models independently, with some naming drift already documented (`MONGO_DB` vs `MONGO_DB_NAME`, `ENRICHMENT_API_BASE` vs `ENRICHMENT_BASE_URL`).

**Unverified but important:** `infra/render/*.render.yaml` are explicitly labeled "reference copies" in `MIGRATION_PLAN.md`. Render services deploy from a specific connected repo+branch — moving code into a new repo doesn't automatically repoint an existing Render service. **This needs to be checked directly in the Render dashboard**, not inferred from the repo.

### 3.2 `AI_Agent_Warrant` (keep — the orphaned piece)

The oldest repo in the whole portfolio (started 2025-08-22) and one of the two still getting commits through May 2026. This is a real FastAPI service, not a prototype:

- **Telnyx AI Assistant tool endpoints** (Bearer-token authenticated): `find_person`, `get_bail_status`, `create_bail_inquiry`, `attach_caller`, `transfer_target`/`transfer_plan` (time-of-day and county-aware call routing with a schedule engine), `notify_agent` (SMS to on-call agents, Telnyx-first with Twilio fallback), plus optional signed webhooks for AI session/call/recording events.
- **County-scoped inmate lookup** added Nov 2025 that queries the `simple_*` collections directly — the same collections `warrantdb-pipeline` populates. This means the two systems are **already data-compatible**, they just live in different repos and deployments.
- A public check-in flow (GPS + optional S3 photo upload, one-time tokenized links) — a feature that doesn't exist anywhere else in the portfolio.
- **Live-tested**: there's an actual SIP call trace on disk from a real call through a real carrier number, and it's deployed at `ai-agent-warrant.onrender.com`.
- Took security seriously early: `SECURITY.md`, a pre-commit hook blocking credential commits, and no evidence `.env` was ever committed to git history.

**Gaps:**
- Zero references to/from `warrant-system` — it's organizationally isolated even though it's functionally ready to plug in.
- No `render.yaml`/Dockerfile in the repo — its Render deployment was configured by hand in the dashboard, not as infrastructure-as-code. Harder to reproduce or move.
- Docs reference a "Ground Truth" set of files (`Ground_Truth_Foundation_Report.md`, `System_Flow_Ground_Truth.md`, `Docs_Code_Gap_Analysis.md`) that don't actually exist in the repo — likely because `docs/` was gitignored partway through (Nov 14, 2025) and those were never committed, or exist only locally on someone's machine.

### 3.3 `bail-bonds-UI-app` (standalone — archive)

Frozen since Dec 8, 2025. Everything of value here was carried into `warrant-system/apps/dashboard`, which has since moved ahead (Scraper Ops panel, Wharton support, bond breakdown charts — none of which exist in this standalone copy). The one thing worth noting: its `Admin.jsx` integrations panel lists "Telnyx Messaging" as `connected` — **this was mock/placeholder data**, not a real integration status check. Don't mistake that UI for evidence the Telnyx agent was ever wired in.

### 3.4 `inmate_enrichment` (standalone — archive, but treat the service as urgent)

Frozen at the exact moment of migration (2026-04-25). Well-organized monorepo (api/worker/shared/web packages), with genuinely useful self-audit docs already written (`BOOT_AUDIT.md`, `ENV_AUDIT.md`, `REPOSITORY_STRUCTURE_AUDIT.md`, etc.) that pinpoint concrete, fixable issues — the Redis-readiness-check mismatch being the main one blocking a clean boot. This is the piece that determines whether related-party/contact enrichment actually works end-to-end, and it's had the least attention of any component since the migration (1 commit). If nobody works on it, the CRM's enrichment panel will keep showing partial/blank contact data (a gap already flagged in its own `Enrichment_Wiring_Status.md`).

### 3.5 `warrantdb-pipeline` (standalone — archive)

Frozen 2026-04-25, one commit after migration (a Render start-command fix that was then carried forward). All subsequent county-scraper work — Fort Bend discovery, Wharton County, Harris Sheriff enrichment, the v2 staging/scheduler system — happened only in `warrant-system/services/warrantdb-pipeline`. This standalone copy is now stale and will only cause confusion if kept around as if it were current.

---

## 4. What "Full Scraping of Counties" Actually Covers Today

| County | Scraper exists | Wired to scheduler | Status |
|---|---|---|---|
| Harris | Yes (multiple: inmate, sheriff enrichment, email roster, reports) | Yes — nightly | Most mature source |
| Galveston | Yes | Yes — every 15 min | Active |
| Jefferson | Yes | Yes — 3x/day | Active |
| Fort Bend | Yes (discovery + ingest) | Manual trigger only | Intentionally not automated yet |
| Brazoria | Yes | **Disabled** | Network access issue from outside local network — unresolved |
| Wharton | Yes (DCN ingestion) | **No** | Code exists, not in scheduler config at all |

So "full county coverage" is roughly **3 of 6 counties on autopilot**, one manual-only by design, one blocked on a network/access problem, and one built but not switched on.

---

## 5. Critical Open Questions (verify before planning further)

1. **Where does production traffic actually come from right now?** The dashboard's `render.yaml` uses `autoDeploy: false` tied to the `deploy/production` branch of the *standalone* `bail-bonds-UI-app` repo. Has this Render service been repointed at `warrant-system`, or is production still running older code than what exists in the monorepo? **Sharpened 2026-08-22 (see Section 8):** confirmed directly in the local clone that `deploy/production` is frozen at a commit from **2025-10-11** — 4 commits behind `main`, and `main` itself is missing a **2026-04-25 security fix that removed a hardcoded, shared MFA/TOTP secret** (it only exists on an orphaned snapshot branch). If Render is still deploying `deploy/production`, that vulnerability is very likely live in production today. This is now the single highest-priority item in Phase 0.
2. **Is `AI_Agent_Warrant` currently taking live calls?** It's deployed and has real call logs, but is it actively in use with real clients today, or was it a build-and-pause?
3. **What's blocking Brazoria's scraper?** ("network issue outside the local network" per the scheduler comments) — is this a firewall/IP-block situation on the county's end, or something fixable on your infrastructure?
4. **Twilio A2P 10DLC campaign** — is this still pending carrier approval, or was it approved and just never re-tested? This single approval unblocks the dashboard's SMS/messaging feature.
5. Do you want **one messaging provider** going forward? Right now the dashboard's messaging plan recommends Twilio, while the Telnyx agent already has working Telnyx messaging — worth deciding instead of running both.

---

## 6. Phased Plan

### Phase 0 — Verify & Stabilize (this week, low risk)
- [ ] Confirm in the Render dashboard which repo/branch each live service actually deploys from (dashboard API, dashboard web, pipeline API, pipeline worker/crons, AI agent).
- [ ] Confirm current status of the Twilio A2P 10DLC campaign.
- [ ] Confirm whether `AI_Agent_Warrant` is live-handling real calls today.
- [ ] Once confirmed, **archive** the three superseded standalone repos (`bail-bonds-UI-app`, `inmate_enrichment`, `warrantdb-pipeline`) — GitHub's "Archive" (not delete) so history is preserved but nobody accidentally commits to a dead branch.

### Phase 0.5 — Security & Housekeeping in `WarrentDB` (found 2026-08-22, do immediately — see Section 8)
- [ ] **Deferred at user's request (2026-08-22): "no need to check render at the moment... we will redeploy when the system is working again."** Confirm whether `deploy/production` (branch of `bail-bonds-UI-app`) is what Render actually serves. If yes, merge forward (at minimum) the hardcoded-MFA-secret fix from commit `0cb92c3` (`safety/2025-12-14-snapshot` branch) into `main` and `deploy/production`, and redeploy. **Still the single highest-priority open item.**
- [x] *(partial, 2026-08-22)* GCP service-account key (`warrentscrapingdb/credentials.json`) untracked from git (`git rm --cached` + `.gitignore`), left uncommitted for review. **Not yet rotated in GCP Console** — no `gcloud` CLI available locally, and rotating a live credential needs account access only the user has. Still sitting in that repo's git history regardless of untracking.
- [x] *(2026-08-22)* Consolidated the two local clones of `bail-bonds-UI-app`: archived `WarrentDB/Bail-Bonds-Dashboard` (its uncommitted diff was pure trailing-newline noise, confirmed no real content) into `WarrentDB/_archive_2026-08-22/`; `~/Projects2025/bail-bonds-deployment` is now the sole local clone.
- [x] *(2026-08-22)* `Bail_bond_buddy_web_site` — confirmed via live fetch that its content is currently serving at `www.bailbondbuddy.com` (exact page-title match). **Decision: keep as its own separate, active repo** — it's live production traffic for a distinct B2B SaaS product ("Bail Bond Buddy," marketed *to* bail bond agencies), not part of `warrant-system`'s consolidation scope. Not to be archived.
- [x] *(2026-08-22)* Deleted (archived, not removed) the confirmed-junk items from `WarrentDB`: `ai_agent/`, `rapid_locate_link/`, `rapid_locate_backupscripts/`, `Backup_programs/`, the nested `WarrentDB/WarrentDB/` duplicate, and the loose top-level `galveston_scraper_playwright.py` — all moved to `WarrentDB/_archive_2026-08-22/`. Safe to permanently delete once confirmed unneeded.

### Phase 1 — Fix the Enrichment Service (highest-priority repair) — ✅ done 2026-08-22
- [x] Fixed the Redis readiness check in `services/inmate-enrichment/tools/ensure_stack.js` — now polls `docker compose exec redis redis-cli ping` instead of a host-loopback TCP check that could never succeed (Redis is deliberately not published to the host).
- [x] Re-ran the boot sequence end-to-end against the live Docker stack; `api` container reported `(healthy)`, `/health` returned `{"ok":true}`, and a real login/session flow was exercised through it.
- [x] The "related-party contact aggregation" gap turned out to be diagnosed wrong in this doc — investigation showed the backend (`GET /enrichment/related_parties`) already returns aggregated `contacts`/`addresses` per party; no summary endpoint was missing. The actual gap was that the frontend hooks (`hooks/enrichment.js`) were imported nowhere in the app. Closed by wiring a "Related parties" table + re-enrich action into `CaseDetail.jsx`'s Enrichment tab instead of building the originally-proposed (and unnecessary) endpoint.

### Phase 2 — Merge in the Telnyx AI Agent — ✅ done 2026-08-22
- [x] Added `AI_Agent_Warrant` as a fourth service (`services/ai-agent/`) via `git subtree` — all 78 commits preserved, after scrubbing a tracked PII file (`.env.oncall.agents`, real on-call agent names/numbers) from history first with `git filter-repo`.
- [x] **Deliberately kept on its own MongoDB database (`ai_agent`), not the same one as the rest of the stack** — the original plan item above was wrong: investigation found the dashboard already has a `checkins` collection, and ai-agent has its own separate `checkins` collection for its compliance check-in flow. Sharing a database would have silently collided the two. ai-agent's fast-path `simple_*` lookup code still exists but is currently a no-op on its own database.
- [x] Wrote `infra/render/ai-agent.render.yaml` (mirrors `pipeline.render.yaml`'s house style) and `services/ai-agent/Dockerfile` — neither existed before (deployment was hand-configured in the Render dashboard).
- [x] Added to `docs/architecture/OVERVIEW.md` and `infra/docker/docker-compose.yml` (own `ai-agent-mongo` + `ai-agent-api` services); build + boot verified locally, `/healthz` returns ok.
- [x] The "Ground Truth" docs weren't missing — they existed as real files in the source repo's working tree, just gitignored/never committed. Copied directly rather than recreated.
- Landed on branch `merge/ai-agent-service`, then merged into `main` locally on 2026-08-23 (per user's go-ahead) — **not yet pushed to any remote.**

### Phase 3 — Harden County Scraping — mostly done 2026-08-23
- [x] **Diagnosed Brazoria — root cause is not a network/firewall issue.** `portal-txbrazoria.tylertech.cloud` (the source actually wired to the scheduler) is fully reachable but AWS WAF Bot Control CAPTCHA-challenges the request (`x-amzn-waf-action: captcha` response header, body titled "Human Verification"). Confirmed by inspecting the actual response, not inferred. Not fixable in code — user chose to pursue official API access / an IP allowlist exception from Brazoria County or Tyler Technologies rather than any code-side workaround. Remains disabled until that's resolved; comments in `scheduler/config.py` and `render.yaml` updated with the accurate diagnosis. (Separately: `pubweb.brazoriacountytx.gov`, a second unused Brazoria source in the codebase, does have a genuine connection timeout — but it isn't the one wired to the scheduler.)
- [x] Wired Wharton into `scheduler/config.py` (`SUPPORTED_SOURCES`, hourly schedule) and added its Render cron job. Live-tested against the real site. Turned out it already had a 19/19 successful run history — just never scheduled.
- [x] **Fort Bend promoted to scheduled** (twice daily, `--mode auto`) — per user's decision, backed by real evidence: 4/4 actual (non-dry-run) writes in `ingestion_runs` succeeded with zero failures, meeting the original manual-only restriction's own stated bar.
- [x] Ran `scripts/check_v2_promotion_readiness.py` against real production data (read-only query, `ingestion_runs` collection). **Result: every source is BLOCKED — not due to data quality, but because there have been zero ingestion runs of any kind since 2026-05-20.** The entire pipeline has been dormant for ~3 months. Strong lead on why: `infra/render/pipeline.render.yaml` (possibly the file Render's blueprint actually points at) was missing every cron job definition that exists in the real `services/warrantdb-pipeline/render.yaml` — now synced. Still unconfirmed without the deferred Render dashboard check (see Phase 0/0.5) — but this may be the actual unblock.

### Phase 3.5 — Full System Verification (2026-08-23) — pre-Render-rebuild gate

User's explicit condition before any Render redeploy: prove dev is actually pulling real county data, enrichment works, the frontend/CRM works, and the Telnyx agent is calling the database and computing transfer routing correctly. This phase is that verification, done against real (not synthetic) data wherever possible.

**Sandbox architecture fix (prerequisite, found the hard way).** A local seeding script accidentally wrote 250 test documents to the real Atlas cluster before this was caught (landed in a `test` database due to a separate connection-string bug, not the real `warrantdb` — cleaned up, production data was never touched; a stray `test-admin@example.com` user that *did* land in real `warrantdb.users` from earlier session testing was also removed). Root cause: `apps/dashboard`, `services/inmate-enrichment`, and `services/warrantdb-pipeline` all defaulted local dev straight to the production Atlas connection string, with no isolated sandbox at all. Fixed properly, not just avoided:
- [x] Every service's local Mongo target is now hardcoded directly in its own tracked `docker-compose.yml` (dashboard/inmate-enrichment/warrantdb-pipeline `api`/`worker` services all explicitly set `MONGO_URI` in their own environment block) — safe by construction, doesn't depend on any `.env` file or gitignored override.
- [x] Real Atlas credentials preserved per-service in a gitignored `.env.atlas` backup file, one command away if deliberately needed — nothing lost.
- [x] **Learned mid-fix**: giving `warrantdb-pipeline` its own isolated local Mongo (matching the "each service gets its own sandbox" instinct) broke the fact that production has the dashboard and pipeline **sharing one database** (`warrantdb`) — confirmed by testing: real scraped data went in fine, dashboard showed 0 cases, until the pipeline's local target was repointed at the dashboard's own local Mongo (`host.docker.internal:27018` for the containerized path). `inmate-enrichment` and `ai-agent` correctly keep their own separate local databases — that part of the architecture was right.

**County scraping** — real scrapers run against real county sites, real current data written to the local sandbox:
- [x] Jefferson: 9 real records. Wharton: 19. Harris reports: 488. Fort Bend: 9 (via `--last-name SMITH`; a broader seed-mode sweep ran clean with 0 matches, confirming the site itself works). All today's date, all flowing correctly into the dashboard's Cases list (v2_* collections) once the sandbox fix above landed — 513 real cases visible with correct KPIs.
- [ ] **Galveston failed**: TLS handshake completes and is certificate-valid, the HTTP request sends successfully, then the server resets the connection with no response at all — a different signature than Brazoria's WAF challenge (see Phase 3). Very likely specific to this sandbox environment's outbound IP, not a new production issue — Galveston ran reliably every 15 minutes for months before the system went dormant. **Needs a retest from Render's actual network before concluding anything is actually broken in production.**
- Brazoria: still the known WAF-blocked case from Phase 3, unchanged.

**Enrichment** — found and fixed a real, pre-existing bug, not a v2-migration artifact:
- [x] **Root cause**: `Case` (the model every case-scoped dashboard route imports) is hardcoded to `CaseHarris` everywhere in `apps/dashboard/server/src/routes/cases.js` — the existing `pickCaseModel(county)` helper in `models/Case.js` is never called. Every existence/access check built on `Case.findOne` has therefore only ever worked for Harris County cases. Jefferson has been broken the same way since before the v2 migration; Fort Bend/Wharton/Galveston/Brazoria never had a Case model wired in at all. Since the Cases list/detail views already read v2_* collections, essentially every case visible in the dashboard today hit this as a 404 on "Run Enrichment."
- [x] Fixed every **read-only** existence check (enrichment GET/POST/select, messages, message resend, activity GET/POST) to search `simple_*` then `v2_*`, mirroring the pattern `GET /cases/:id` already used.
- [ ] **Deliberately not fixed**: the CRM *write* routes (`PATCH /:id/tags`, `/:id/stage`, `/:id/crm`) still only persist for Harris cases. Fixing their access check alone would make them stop 404ing while the underlying `Case.updateOne`/`findOneAndUpdate` still silently matches zero documents for every other county — a misleading false-success, worse than today's honest 404. **Real fix needs a decision**: extend `Case` models to all 6 counties (mirrors the existing pattern, `pickCaseModel` already half-built for it) vs. a unified CRM-overlay collection keyed by `{sourceCollection, _id}`. Flagged for deliberate follow-up, not decided unilaterally.
- [x] Verified end-to-end through the real browser: opened a real scraped Fort Bend case, ran a real Pipl lookup — case found, enrichment record created/cached/audited correctly.
- [ ] **Both configured enrichment providers are currently non-functional, for two unrelated external reasons — not code bugs**: Pipl's package subscription expired 2025-10-29 (confirmed directly against Pipl's API: `"Your package usage allowance has expired"`). Whitepages' hardcoded API domain (`proapi.whitepages.com`) no longer resolves via DNS at all — likely dead since the Whitepages Pro → Ekata → Mastercard acquisition chain. Both need account-level attention (renew Pipl, or switch providers) before enrichment can return real results.

**Frontend + CRM tools** — verified through the actual browser, not just API calls:
- [x] Login (Passport.js), 513 real cases with correct KPIs, opened a real case detail page, ran real enrichment, added a real activity note that persisted and appeared in the timeline immediately.

**Telnyx AI agent** — booted locally with the real credentials from the original `AI_Agent_Warrant` repo (see `services/ai-agent/.env.example`, updated with setup notes and a boot-blocking `.env` trap fix found along the way), pointed at the shared local sandbox specifically so its `simple_*` fast-path lookup had real data to find:
- [x] `POST /telnyx/find_person` → found a real seeded Harris record (bearer-token authenticated), returned custody status and bond.
- [x] `POST /telnyx/get_bail_status` → correctly computed `eligible: true` from the real $100 bond amount.
- [x] `POST /telnyx/transfer_plan` → returned the real configured Harris County transfer number and attempt timeout — correct county-based call-routing logic, verified **without placing any actual call**.

**Net gate status**: county scraping (3/5 sources proven, Galveston needs a real-network retest, Brazoria still externally blocked), enrichment infrastructure (fixed, but both providers need account attention before they'll return data), frontend/CRM (working, with the write-target architecture decision flagged), Telnyx (fully verified) — mostly green, not fully green. Brazoria/Galveston and the two enrichment vendor accounts are genuine external blockers, not engineering work; the CRM write-target question is a real decision that should happen before or alongside any Render rebuild, not after.

### Phase 4 — Close the CRM/Messaging Gap
- [ ] Decide: Twilio vs. Telnyx as the single messaging provider for the dashboard (the AI agent already proves Telnyx messaging works).
- [ ] Replace the dashboard's mock `INTEGRATIONS` list in `Admin.jsx` with a real status check once a provider is chosen.
- [ ] Finish check-ins reminders/GPS queue (documented as outstanding in `final-feature-readiness.md`).

### Phase 5 — Consolidation Cleanup
- [ ] Extract genuinely shared fields into `packages/shared-schema` (currently a stub).
- [ ] Standardize env var naming across services (`MONGO_DB` vs `MONGO_DB_NAME`, proxy URL naming, etc. — already catalogued in the existing `ENV_AUDIT.md` files).
- [ ] Remove the vestigial `sleep infinity` Render worker in the pipeline service now that cron jobs do the real work.
- [ ] Repoint (or recreate) Render services to deploy from `warrant-system` as the single source of truth, retiring the standalone repos' deploy hooks.

---

## 7. Immediate Next Actions (start here)

**Updated 2026-08-23 — items 2 and 4 are done; superseded by Phase 3.**

1. ~~Check Render dashboard service-to-repo mappings~~ — deferred at the user's request ("no need to check render at the moment... we will redeploy when the system is working again"). Still the top item once that changes — see 8.1 below, the hardcoded-MFA-secret risk is real and unresolved.
2. ~~Fix the `inmate-enrichment` Redis readiness check~~ — done, see Phase 1.
3. Get a straight answer on Brazoria's network issue and the Twilio A2P campaign status — still open, both "waiting on an external party."
4. ~~Schedule the `AI_Agent_Warrant` merge~~ — done, see Phase 2.
5. **Next up: Phase 3 (harden county scraping)** — Wharton wiring is the smallest, most self-contained item; Brazoria is the actual unresolved blocker.

---

## 8. `WarrentDB` Folder Audit (2026-08-22)

The original audit's 5-repo scope missed a large amount of local sprawl living in `~/Documents/Projects2025/WarrentDB` (and two adjacent folders outside it). This section catalogs everything found there, verified by git remote/branch/commit inspection and targeted content checks rather than full reads — see chat method note. Nothing here changes the Section 1 ranking; it closes out whether anything valuable was being overlooked. **Short answer: no hidden capability was missed** — the one candidate (`rapid_locate_link`) was confirmed already absorbed into `AI_Agent_Warrant`. One new undecided item surfaced (`Bail_bond_buddy_web_site`), and two security items surfaced that don't appear anywhere in Sections 1–7.

### 8.1 Critical findings

1. **Hardcoded MFA secret likely still live in production.** `bail-bonds-UI-app`'s `deploy/production` branch — the branch the original audit flagged as what Render deploys from — is frozen at commit `0223f0b` (2025-10-11). A 2026-04-25 commit (`0cb92c3`, `security: remove hardcoded MFA secret + add phase 1 audits`) replaced a static, identical-for-every-user TOTP secret (`JBSWY3DPEHPK3PXP`) in `src/components/auth/MFAEnrollment.tsx` with a server-issued one. That fix exists only on an orphaned branch (`safety/2025-12-14-snapshot`) — confirmed via `git merge-base --is-ancestor` that it is **not** an ancestor of `main` and **not** an ancestor of `deploy/production`. Anyone who inspected the shipped bundle could derive valid 2FA codes for any account's "MFA."
2. **Live-shaped GCP service-account key committed to git.** `warrentscrapingdb/credentials.json` is tracked in git and parses as a full GCP service-account JSON (`private_key`, `client_email`, `project_id`, etc.). Repo is confirmed **private** on GitHub (checked via `gh repo view`), so this is a hygiene issue rather than a public leak, but the key should be rotated and the file scrubbed from history before the repo is touched further.

### 8.2 Full classification

| Item | What it is | Verdict |
|---|---|---|
| `AI_Agent_Warrant` | Telnyx agent — verified clean: on `main`, in sync with `origin/main`, zero local changes | **Keep — canonical, live** |
| `rapid_locate_link` | Standalone GPS check-in / tokenized-link prototype (`geo.py`, `tokens.py`, `templates/checkin.html`), 1 commit, 2025-08-22 | **Archive** — confirmed absorbed into `AI_Agent_Warrant` (identical filenames present there: `app/geo.py`, `app/tokens.py`, `app/templates/checkin.html`) |
| `rapid_locate_backupscripts` | Earlier draft of the same `geo.py` | **Delete** — duplicate of the above |
| `ai_agent` | Two single-file Flask/FastAPI Twilio "starter" snippets, no git, literally copy-paste templates with instructions embedded | **Delete** — throwaway prototype, fully superseded by `AI_Agent_Warrant` (79 commits, live) |
| `Bail-Bonds-Dashboard` (in `WarrentDB`) + `bail-bonds-deployment` (`~/Projects2025`, outside `WarrentDB`) | Two separate local clones of the same repo, `bail-bonds-UI-app`. `Bail-Bonds-Dashboard` is checked out on `safety/2025-12-14-snapshot` with uncommitted doc edits; `bail-bonds-deployment` is on `main`, in sync with origin. | **Archive the GitHub repo — after** resolving the `deploy/production` question (8.1) and consolidating to one local clone |
| `warrantdb-pipeline` (in `WarrentDB`) | Standalone pipeline repo | **Archive** — confirmed superseded by `warrant-system/services/warrantdb-pipeline`, matches original audit's commit history exactly |
| `Backup_programs/` | Two `.zip` snapshots of `Bail-Bonds-Dashboard` and `warrantdb-pipeline` | **Delete** — redundant with the actual repos |
| `Scraping script backups/` | ~19 versioned scraper drafts (galveston v1–v7, brazoria, fortbend, geo_v2) + a stray dashboard file copy | **Delete/archive** — see 8.3 for the Brazoria-specific check; no working fix recovered, safe to archive |
| `warrentscrapingdb` | Earliest scraper prototype (Aug 2025, 2 commits) | **Archive — after** rotating/removing `credentials.json` (8.1) |
| `WarrentDB/WarrentDB` (nested) | Non-git duplicate copy of `Bail_bond_buddy_web_site`, stray accidental duplicate | **Delete** — zero unique content |
| loose `galveston_scraper_playwright.py` (top-level) | 139-line scratch script | **Delete** — superseded by `services/warrantdb-pipeline/ingestion/galveston_p2c_fast.py` |
| `comfyUIfast.json` | ComfyUI image-gen workflow file | **Not part of this system** — unrelated, move elsewhere |
| `Bail_bond_buddy_web_site` (+ its `bailbondbuddy-site` GitHub repo) | Figma-exported marketing-site scaffold, 18 commits, that later got real "v4 10DLC updates (clarified disclosures, added examples)" work | **Undecided — needs your call.** Not superseded by anything else in the portfolio, not in the original audit's scope. The 10DLC-compliance commits suggest it may be tied to the still-pending Twilio A2P campaign (carriers commonly require a live, compliant public site as part of 10DLC vetting) — worth checking if/where it's deployed before archiving. |

Also found, part of the same system but outside `WarrentDB`:
- `~/Projects2025/Data_General/Inmate_enrichment` — this **is** the `inmate_enrichment` standalone repo from Section 1 (7 commits, frozen 2026-04-25) — just filed under `Data_General/` rather than `WarrentDB/`.

### 8.3 Brazoria backup scripts — checked, no fix recovered

`Scraping script backups/brazoria_ingest_backup_v1.py` and `brazoria_jail_Backup_v1.py` were compared against the current, scheduler-wired implementation (`services/warrantdb-pipeline/ingestion/brazoria_jail.py`, `ingestion/lookups/brazoria_lookup.py`). Both the backup and the current `brazoria_jail.py` target the **same base URL** (`https://pubweb.brazoriacountytx.gov/PublicAccess/`) using the **same technique** — a `requests.Session` with spoofed Chrome `User-Agent` headers and `Referer`-based session warm-up. The backup is not a different, working approach; it's the same code lineage. There's a second, separate Brazoria source in the current codebase (`portal-txbrazoria.tylertech.cloud`, used by `ingestion/lookups/brazoria_lookup.py`, the one actually wired into `scheduler/config.py`) with its own unresolved diagnostic script (`scripts/_probe_brazoria.py`) but no recorded findings. **Conclusion: the "network issue outside the local network" blocker remains genuinely unresolved** — nothing in the backups solves it, so Phase 3's Brazoria item stands as originally scoped.
