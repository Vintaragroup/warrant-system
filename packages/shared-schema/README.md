# @warrant-system/shared-schema

Documentation-first schema contracts for the warrant-system monorepo.

This package is **documentation only** — no code is wired yet. All `.md` files
here are the binding contracts that each service must satisfy. When types are
eventually extracted, they will live alongside these docs.

## Purpose

Three services write and read overlapping fields in MongoDB. Without a shared
contract, each service has drifted its own field names, types, and defaults.
This package defines the canonical versions and explicitly names the aliases
that are temporarily tolerated during migration.

## Collection Ownership

| Collection | Owner | Write authority | Read authority |
|---|---|---|---|
| `simple_<county>` | `warrantdb-pipeline` | pipeline only | pipeline, enrichment (read-only) |
| `inmates` | `inmate-enrichment` | enrichment only | enrichment, dashboard (via proxy) |
| CRM overlay (cases, contacts, checkins) | `bail-bonds-dashboard` | dashboard only | dashboard only |

**No service writes to another service's collection.** The enrichment service
reads from `simple_*` during sync and writes to `inmates`. The dashboard reads
`inmates` via the enrichment API proxy. Neither the dashboard nor the pipeline
writes to `inmates` directly.

## Canonical Identifiers

| Field | Type | Scope |
|---|---|---|
| `spn` | `string` | Shared identifier across all three services. Must be present and non-empty on every `simple_*` and `inmates` document. |
| `county` | `string` (lowercase slug) | Identifies source county. See [county-normalization.md](./county-normalization.md). |

## Schema Documents

| File | Describes |
|---|---|
| [simple-case.schema.md](./simple-case.schema.md) | `simple_<county>` collection — pipeline output contract |
| [enrichment-subject.schema.md](./enrichment-subject.schema.md) | `inmates` collection — enrichment service contract |
| [timestamps.md](./timestamps.md) | Canonical timestamp fields, aliases, and format rules |
| [county-normalization.md](./county-normalization.md) | Allowed county slugs and normalization rules |
| [bond-normalization.md](./bond-normalization.md) | `bond_amount` coercion rules and null handling |

## Status

Not yet implemented. Each service still uses its own schema definitions.
See `services/inmate-enrichment/shared/src/models.ts` for the most complete TypeScript model set.
