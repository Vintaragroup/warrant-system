# Working Notes (Rolling)

Lightweight, rolling notes to rehydrate context quickly if the editor session resets.

## Current priorities

- Verify OpenAPI mentions: Align `api/src/openapi.ts` with documented endpoints in `docs/API_Endpoint_Map.md` (related parties, pipl matches, related audits, validate phones). If not adding spec coverage now, annotate coverage gaps.
- Finish Case UI polish per `docs/Case_UI_Refinement_Plan.md` and validate with SPN 02865254.
- Prepare Render production per `docs/Production_Prep_Checklist.md` (proxy allowlist, env alignment, smoke tests).

## Recent changes

- Added multi-root workspace (`Enrichment_Dashboard.code-workspace`) to open Dashboard + Enrichment together.
- Added VS Code tasks to run API stack and Dashboard dev.
- Implemented cooldown-aware Re-enrich buttons in Dashboard `CaseDetail.jsx` (disable + ETA).
- Authored:
  - `docs/Case_UI_Refinement_Plan.md`
  - `docs/Production_Prep_Checklist.md`
  - `docs/Workspace_Guide.md`

## OpenAPI coverage snapshot (2025-10-22)

- Present in `api/src/openapi.ts`:
  - GET `/enrichment/prospects_window`
  - POST `/enrichment/dob_sweep`
  - GET `/enrichment/subject_summary`
  - GET `/enrichment/coverage24h`
  - GET `/enrichment/coverage72h`
  - GET `/providers/pipl/test`
  - POST `/enrichment/pipl_first_pull`
- Missing from spec but documented in Endpoint Map:
  - GET `/enrichment/related_parties`
  - POST `/enrichment/related_party_pull`
  - GET `/enrichment/related_party_audits`
  - POST `/enrichment/related_party_validate_phones`
  - GET `/enrichment/pipl_matches`

Action: Either extend the OpenAPI spec to include the above paths or explicitly state in docs that these are currently outside the live spec but stable and supported.

## Next small steps

- Update OpenAPI or add `OpenAPI_Coverage_Gaps` note in `docs/API_Endpoint_Map.md` intro.
- Run SPN 02865254 QA end-to-end, record PASS/FAIL, and file any UI deltas under the Case UI plan.
