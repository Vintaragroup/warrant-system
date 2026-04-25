# Related Parties API

This document describes the related-party enrichment endpoints, response shapes, and the score display semantics used by the dashboard.

## Score semantics (display)

- Normalized score range: [0, 1].
- High-quality threshold: 0.75 (75%).
- Display rules:
  - 0% means: pull ran, but no acceptable match was found.
  - — (em dash) means: not scored / unknown.

## Endpoints

### GET /api/enrichment/related_parties

List related parties for a subject.

Query:

- subjectId (string, required)

Response:

- 200 OK: { ok, count, rows: RelatedPartyItem[] }

RelatedPartyItem fields:

- subjectId (string)
- partyId (string|null)
- name (string|null)
- relationType (string|null) — e.g., family | associate
- relationLabel (string|null) — provider/native label or inferred/overridden display label
- confidence (number|null)
- lastAudit (object|null) — includes:
  - match (0–1; 0 = pulled/no acceptable match; null = not scored)
  - accepted (boolean|null)
  - personsCount (number|null)
  - netNewPhones (number|null), netNewEmails (number|null), netNewAddresses (number|null)
  - gainedData (string[]|null) — e.g., ["phone","email"] when new items were added in the last run
  - cooldownUntil (ISO string|null) — when targeted re-enrich becomes available again
- contacts: { phones: string[], emails: string[] }
- addresses: string[]
- createdAt, updatedAt (ISO strings)
- lastTargetedAt, cooldownEndsAt (ISO strings, optional)

Notes:

- Contacts and addresses are included to support UI counts (Phones/Emails/Addresses columns).

### POST /api/enrichment/related_party_pull

Enrich related parties via Pipl and upsert contacts.

Body:

- subjectId (string, required)
- maxParties (integer, default 3)
- requireUnique (boolean, default true)
- matchMin (number, default 0.75)
- partyId (string, optional) — targeted run
- partyName (string, optional) — targeted run by name
- aggressive (boolean, default false) — enables multi-attempt fallback

Response:

- 200 OK: { ok, subjectId, targeted, tried, updated, skipped, cooldownMinutes, details[] }

details[] items include net-new value information when applicable:

- partyId, name, relationType/label
- netNewPhones, netNewEmails, netNewAddresses (numbers)
- gainedData: ["phone"|"email"|"address", ...]

Notes:

- Targeted runs observe a cooldown (env: PARTY_PULL_COOLDOWN_MINUTES, default 30 minutes) to avoid repeated billable calls.
- Acceptance policy: accept by score (>= matchMin) or unique (personsCount=1 and score close to threshold), plus last-name agreement when available.
- Value gate: only net-new phones/emails/addresses are written to a party; no-op pulls return zero net-new counts to avoid wasted charges.

### POST /api/enrichment/related_party_override

Administrative override to correct a party's relationship classification.

Body:

- subjectId (string, required)
- partyId (string, required) — or identifying fields (e.g., name) depending on implementation
- relationType (string, optional) — e.g., family | associate
- relationLabel (string, optional)
- confidence (number, optional)

Response:

- 200 OK: { ok, matched: number, modified: number }

Notes:

- Use to fix misclassified relationships (e.g., elevate to family). UI should treat relationLabel as the display source, falling back to relationType.

### GET /api/enrichment/related_party_audits

Audit history for a subject’s related parties.

Query:

- subjectId (string, required)
- partyId (string, optional)
- limit (integer, default 50)

Response:

- 200 OK: { ok, count, summary, rows }

Summary fields include totalAudits, accepted, rejected, acceptanceRatePct, lastTargetedAt.

### POST /api/enrichment/related_party_sweep

Batch sweep to enrich subjects whose related parties lack contacts.

Body:

- subjectIds (string[], optional) — when omitted, selects recent subjects automatically
- windowHours (integer, default 48)
- maxSubjects (integer, default 5)
- maxParties (integer, default 3)
- requireUnique (boolean, default true)
- matchMin (number, default 0.75)

Response:

- 200 OK: { ok, windowHours, subjectsTried, results[] }

### POST /api/enrichment/related_party_validate_phones

Validate related-party phones using Whitepages and store evidence.

Body:

- subjectId (string, required)
- maxPerParty (integer, default 3)

Response:

- 200 OK: { ok, subjectId, tried, partiesUpdated, details[] }

## Dashboard integration notes

- Details view prefers high-quality related parties (score >= 75%) and falls back to provider candidates.
- Full results include a Related Parties table with counts for Phones/Emails/Addresses and an Actions column (Re-enrich).
- Re-enrich calls POST /api/enrichment/related_party_pull with targeted=true and aggressive=true from the UI.
- Provider keys remain service-side only; the dashboard calls proxy-safe endpoints defined above.
- The UI displays relationLabel (fallback to relationType) and shows the last run timestamp with net-new deltas, e.g., "2025-10-22 14:03 • +2p +1e".
- Optional: a sort control can order related parties by Score or by Value (sum of net-new items from the last run).

## Relationship labeling and heuristics

- Provider-native fields (e.g., Pipl `@type`, `relation`) map to a normalized relationType and relationLabel.
- When provider labeling is missing or ambiguous, a last-name heuristic may infer "family" if the subject and party share a family name.
- Administrative overrides take precedence and are reflected in both relationType and relationLabel as applicable.
