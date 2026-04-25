# Workspace Guide: Enrichment + Dashboard

This workspace lets you open and develop the Enrichment API, the Bail Bonds Dashboard, and the county scraping pipeline together.

## Open the multi-root workspace

1) In VS Code, File → Open Workspace from File…
2) Select `Enrichment_Dashboard.code-workspace` located in the repo root of `inmate_enrichment`.

Folders included:
- `inmate_enrichment` (this repo)
- `Bail-Bonds-Dashboard` (`/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard`)
- `warrantdb-pipeline` (scraping program, reference only) (`/Users/ryanmorrow/Documents/Projects2025/WarrentDB/warrantdb-pipeline`)

## Run tasks

Open the Command Palette and run “Tasks: Run Task”. You’ll see:

- `api: up (stack:up)` — runs `npm run stack:up` in `inmate_enrichment` to bring up API, worker, Redis, Mongo.
- `api: rebuild (stack:rebuild)` — rebuilds containers then starts them.
- `dashboard: dev` — runs `npm run dev` in `Bail-Bonds-Dashboard` (Vite dev server).
- `dev: api+dashboard` — convenience task to bring up API then start the dashboard dev server.

Tip: You can run `api: up` and then `dashboard: dev` side by side for local development.
For scraping reference, open the `warrantdb-pipeline` folder in the Explorer; we can add tasks later if you want helper commands for that repo.

## Proxy and envs

- Local dev proxy (Vite): map the Dashboard `/api/*` to Enrichment `http://localhost:4000/api/*`.
- UI high-quality threshold: `VITE_HIGH_QUALITY_MATCH` (default 0.75).
- Server threshold: `HIGH_QUALITY_MATCH` (default 0.75). Keep both aligned.
- Provider keys stay on the Enrichment service. The browser only calls dashboard proxy routes.

See also:
- `docs/Dashboard_Proxy_Wiring.md`
- `docs/Case_UI_Refinement_Plan.md`
- `docs/Production_Prep_Checklist.md`
