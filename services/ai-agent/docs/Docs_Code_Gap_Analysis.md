# AI Agent Warrant Docs and Code Gap Analysis

Added: 2026-05-01  
Status: Evidence-based comparison between current docs and current code

## Summary

The documentation is directionally correct, but the codebase has grown beyond the framing used by the top-level README. The current executable service is broader and more operationally mature than the minimal descriptions suggest.

Main finding:

- `README.md` presents the project as a starter FastAPI app.
- `app/telnyx_tools.py` implements a larger production-style operations layer including routing, warm transfer planning, diagnostics, hold management, multi-recipient notifications, and callback queue handling.

## Confirmed Alignments

### System Overview Is Largely Accurate

`docs/System_Overview.md` is broadly consistent with the code.

It correctly describes:

- the split between compliance check-in and Telnyx tooling,
- MongoDB-backed persistence,
- authenticated `/telnyx/*` tools,
- optional webhook logging,
- the existence of transfer planning and SMS diagnostics,
- the public check-in flow.

### Telnyx Integration Guide Is Mostly Accurate

`docs/Telnyx_Integration.md` aligns well with current lookup, bail, inquiry, and transfer behavior.

It correctly documents:

- fast-path simple collections,
- fallback to `persons` plus `custody_events`,
- bond parsing and human-review hints,
- transfer target and transfer plan behavior,
- county and schedule routing.

### Minimal Transfer Only Doc Matches the Narrow Case

`docs/Minimal_Transfer_Only.md` correctly describes a limited deployment mode built around `transfer_target`, while also acknowledging that Mongo still initializes at startup.

## Gaps and Drifts

### 1. README Understates the Current System

Severity: medium

`README.md` still frames the project as a ready-to-run starter with a short list of features.

What is missing from that framing:

- callback queue endpoints,
- hold-detection flow,
- two-stage whisper behavior,
- debug log endpoints,
- agent roster resolution,
- multi-recipient notifications,
- call-log diagnostics,
- duplicate playback endpoints under both main app and Telnyx router.

Impact:

- new operators or developers will underestimate the real surface area,
- onboarding documents may be too shallow for maintenance,
- architectural decisions are harder to understand from the README alone.

Recommendation:

- update `README.md` to present the service as a dual-domain operational system, not just a starter app.

### 2. Documentation Does Not Clearly Declare the Canonical Source Files

Severity: medium

Several docs are good operational references, but there is no single explicit statement that the current source of truth is:

- `app/main.py`
- `app/telnyx_tools.py`
- `app/config.py`
- `app/db.py`

Impact:

- readers may assume prompt docs or archived agent instructions describe current behavior even when implementation has drifted.

Recommendation:

- add a short canonical-source section to the README and System Overview.

### 3. Prompt Docs Describe Behavior That Depends on External Telnyx Flow Configuration

Severity: medium

Files such as:

- `docs/Current-Telnyx-Agent-working-instructions.md`
- `docs/last_agent_prompt.md`
- `docs/Two-Stage-Whisper-Instructions.md`

describe end-to-end conversational behavior. Parts of that behavior are implemented in code, but some steps rely on correct configuration in Telnyx Flow and assistant tooling, not on this repository alone.

Impact:

- a reader may believe the repo fully controls the call experience,
- when behavior differs in production, the real source may be an external Telnyx configuration rather than Python code.

Recommendation:

- explicitly label those docs as `code-backed plus external Telnyx configuration required`.

### 4. Hold Music Delivery Paths Are Duplicated

Severity: low

The code exposes hold music and playback control in more than one place:

- `/hold_music/moonlightdrive.mp3` in `app/main.py`
- `/telnyx/hold_music/moonlightdrive.mp3` in `app/telnyx_tools.py`
- playback start and stop endpoints also exist under both `/ai/*` and `/telnyx/*`

Impact:

- operational teams may not know which endpoint is intended to be canonical,
- future fixes may land in one path and not the other.

Recommendation:

- document which path is canonical, or consolidate the duplicated surfaces.

### 5. Callback Queue Features Are Broader Than High-Level Docs Suggest

Severity: medium

The queue subsystem in `app/telnyx_tools.py` supports:

- enqueueing callback requests,
- listing queue contents,
- updating queue status,
- broadcasting queue summaries to agents.

This is not prominently reflected in the top-level repo documentation.

Impact:

- callback workflow may appear incidental, when it is a real subsystem.

Recommendation:

- document callback queue behavior as a first-class operational capability.

### 6. Giga Rules Describe Intent, Not Exact Runtime Guarantees

Severity: low

The `.giga/rules/*.mdc` files accurately describe business direction, but some statements are stronger than what the code enforces directly.

Examples:

- rules discuss strict multi-provider or two-factor expectations,
- code implements coarse fallback, optional upload behavior, and operational heuristics.

Impact:

- architectural intent can be mistaken for present enforcement.

Recommendation:

- keep using Giga files for business context, but label them as intent and policy context rather than executable guarantees.

## Practical Source-of-Truth Hierarchy

Recommended reading order for future maintainers:

1. `app/main.py`
2. `app/telnyx_tools.py`
3. `app/config.py`
4. `app/db.py`
5. `docs/System_Overview.md`
6. `docs/Telnyx_Integration.md`
7. prompt and archive docs in `docs/`

## Recommended Documentation Changes

### Highest Value

- Update `README.md` to describe the service as dual-domain and operationally mature.
- Add a short `source of truth` section to `README.md` and `docs/System_Overview.md`.
- Promote callback queue behavior into the main documentation set.

### Secondary

- Mark prompt docs as partially dependent on external Telnyx configuration.
- Clarify the canonical hold-music and playback endpoints.
- Separate active operational docs from archived prompt experiments more explicitly.

## Bottom Line

The codebase is in better shape than the top-level framing suggests. The main gap is not that the docs are wrong in detail; it is that the most visible documents still present the project as smaller and simpler than the current implementation actually is.