# Data Schema Audit

## Scope

This audit extracts the effective stored database schema used by the dashboard backend.

Code paths reviewed:

- `server/src/models/*.js`
- `server/src/routes/cases.js`
- `server/src/routes/checkins.js`
- `server/src/routes/documents.js`
- `server/src/routes/messages.js`
- `server/src/routes/payments.js`
- `server/src/routes/auth.js`
- `server/src/routes/users.js`
- supporting services and job code

No `.giga/rules` markdown files were discoverable in this repository during this audit, so the schema description below is grounded directly in code.

## Observations

- This repo owns several app-specific collections directly.
- The county `simple_*` collections are mostly read-only source collections, but this repo writes CRM overlay fields back into them.
- The effective schema is split between source-case data, CRM overlay data, communications, payments, check-ins, and access control.

## Reasoning

The authoritative stored schema is the union of the Mongoose models and the route-level write logic. For the dashboard repo, that matters especially because the same `simple_*` case rows carry both normalized county source data and application-owned CRM fields.

## Collections

- `users`
- `simple_*` case collections
- `case_audits`
- `case_enrichment`
- `check_ins`
- `check_in_pings`
- `messages`
- `payments`
- `access_requests`
- `auth_audit`
- `jobs`

## Field Inventory

### `users`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `uid` | string | Firebase auth/session creation | unique user id |
| `email` | string | Firebase auth and admin user writes | sparse unique |
| `emailVerified` | boolean | Firebase token/session data | auth-owned |
| `displayName` | string | Firebase token or admin user edits | profile name |
| `roles` | string[] | admin user management | role names |
| `departments` | string[] | admin user management | department scopes |
| `counties` | string[] | admin user management | county scopes |
| `status` | enum string | auth and admin updates | `active`, `suspended`, `invited`, `pending_mfa`, `deleted` |
| `mfaEnforced` | boolean | admin user management | security flag |
| `lastLoginAt` | date | auth session creation | last login timestamp |
| `invitedBy` | objectId | admin invite flow | ref to user |
| `invitedAt` | date | admin invite flow | invitation timestamp |
| `lastRoleChangeAt` | date | admin role updates | audit-adjacent |
| `termsAcceptedAt` | date | declared only | no active writes confirmed |
| `privacyNoticeAcceptedAt` | date | declared only | no active writes confirmed |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `simple_*` case collections

These collections contain normalized county source fields plus dashboard CRM overlay fields.

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `_upsert_key.county` | string | external normalizer output | canonical identity component |
| `_upsert_key.category` | string | external normalizer output | canonical identity component |
| `_upsert_key.anchor` | string | external normalizer output | canonical identity component |
| `full_name` | string | external normalizer output | source case person name |
| `county` | string | external normalizer output | county slug |
| `charge` | string | external normalizer output | normalized charge |
| `status` | string | external normalizer output | source case status |
| `booking_date` | string | external normalizer output | source booking date |
| `time_bucket` | string | external normalizer output | source age bucket |
| `bond_amount` | number | external normalizer output | numeric bond |
| `bond_label` | string | external normalizer output | textual bond label |
| `bond` | mixed | external normalizer output | transitional source bond field |
| `case_number` | string | external normalizer output | case identifier |
| `spn` | string | external normalizer output | subject/person identifier |
| `offense` | string | external normalizer output | optional |
| `source` | string | external normalizer output | provenance |
| `source_url` | string | external normalizer output | provenance |
| `source_filename_date` | string | external normalizer output | provenance |
| `tags` | string[] | external normalizer output and app logic | source/system tags |
| `manual_tags` | string[] | dashboard case route | operator-applied tags |
| `address.line1` | string | external normalizer output | source address |
| `address.line2` | string | external normalizer output | source address |
| `address.city` | string | external normalizer output | source address |
| `address.state` | string | external normalizer output | source address |
| `address.zip` | string | external normalizer output | source address |
| `address.postalCode` | string | external normalizer output | source address alias |
| `address.county` | string | external normalizer output | source address |
| `phone` | string | external normalizer output | root contact field |
| `race` | string | external normalizer output | source demographic |
| `sex` | string | external normalizer output | source demographic |
| `crm_stage` | enum string | dashboard case writes | `new`, `contacted`, `qualifying`, `accepted`, `denied` |
| `crm_stage_history[]` | object[] | dashboard case writes | stage transition audit trail |
| `crm_stage_history[].stage` | string | dashboard case writes | stage name |
| `crm_stage_history[].changedAt` | date | dashboard case writes | timestamp |
| `crm_stage_history[].actor` | string | dashboard case writes | user identity |
| `crm_stage_history[].note` | string | dashboard case writes | operator note |
| `crm_details.qualificationNotes` | string | dashboard case writes | CRM notes |
| `crm_details.documents[]` | object[] | dashboard case writes | checklist items |
| `crm_details.documents[].key` | string | dashboard case writes | checklist key |
| `crm_details.documents[].label` | string | dashboard case writes | label |
| `crm_details.documents[].required` | boolean | dashboard case writes | required flag |
| `crm_details.documents[].status` | enum string | dashboard case writes | `pending`, `completed` |
| `crm_details.documents[].completedAt` | date | dashboard case writes | optional |
| `crm_details.documents[].note` | string | dashboard case writes | optional |
| `crm_details.followUpAt` | date | dashboard case writes | follow-up time |
| `crm_details.assignedTo` | string | dashboard case writes | assignee label/id |
| `crm_details.address.streetLine1` | string | dashboard case writes | CRM contact address |
| `crm_details.address.streetLine2` | string | dashboard case writes | CRM contact address |
| `crm_details.address.city` | string | dashboard case writes | CRM contact address |
| `crm_details.address.stateCode` | string | dashboard case writes | CRM contact address |
| `crm_details.address.postalCode` | string | dashboard case writes | CRM contact address |
| `crm_details.address.countryCode` | string | dashboard case writes | CRM contact address |
| `crm_details.phone` | string | dashboard case writes | CRM contact phone |
| `crm_details.attachments[]` | object[] | documents route and case writes | uploaded documents |
| `crm_details.attachments[].id` | string | documents route | generated attachment id |
| `crm_details.attachments[].filename` | string | documents route | stored filename |
| `crm_details.attachments[].originalName` | string | documents route | original upload name |
| `crm_details.attachments[].url` | string | documents route | file url |
| `crm_details.attachments[].mimeType` | string | documents route | content type |
| `crm_details.attachments[].size` | number | documents route | byte size |
| `crm_details.attachments[].uploadedAt` | date | documents route | upload time |
| `crm_details.attachments[].label` | string | documents route | human label |
| `crm_details.attachments[].note` | string | documents route | note |
| `crm_details.attachments[].checklistKey` | string or null | documents route | linkage to checklist |
| `crm_details.acceptance.accepted` | boolean | dashboard case writes | acceptance decision |
| `crm_details.acceptance.acceptedAt` | date | dashboard case writes | timestamp |
| `crm_details.acceptance.notes` | string | dashboard case writes | note |
| `crm_details.denial.denied` | boolean | dashboard case writes | denial decision |
| `crm_details.denial.deniedAt` | date | dashboard case writes | timestamp |
| `crm_details.denial.reason` | string | dashboard case writes | reason |
| `crm_details.denial.notes` | string | dashboard case writes | notes |
| `createdAt` | date | external normalizer or Mongoose depending on collection origin | varies |
| `updatedAt` | date | dashboard writes and/or external normalizer | varies |

### `case_audits`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `caseId` | objectId | case-related routes | audited case reference |
| `type` | string | case/documents/enrichment routes | event kind |
| `actor` | string | request user context | user email or `system` |
| `details` | mixed | route-specific payload | freeform event payload |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `case_enrichment`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `caseId` | objectId | case enrichment route | linked case |
| `provider` | string | case enrichment route | provider id |
| `status` | enum string | case enrichment route | `success`, `empty`, `error` |
| `params` | mixed | `buildEnrichmentParams(...)` and user overrides | outbound lookup payload |
| `requestedBy.uid` | string | auth context | requester identity |
| `requestedBy.email` | string | auth context | requester identity |
| `requestedBy.name` | string | auth context | requester identity |
| `requestedAt` | date | route write | request time |
| `expiresAt` | date | route write | TTL or expiry |
| `candidates` | object[] | provider response | result set |
| `error.code` | string | provider failure | optional |
| `error.message` | string | provider failure | optional |
| `meta` | mixed | provider-specific metadata | optional |
| `selectedRecords[]` | object[] | candidate selection route | operator choice record |
| `selectedRecords[].recordId` | string | candidate selection route | provider record id |
| `selectedRecords[].selectedAt` | date | candidate selection route | timestamp |
| `selectedRecords[].selectedBy` | mixed | candidate selection route | actor identity |
| `selectedRecords[].payload` | mixed | candidate selection route | selection payload |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `check_ins`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `clientId` | objectId | check-in route | declared as ref to `Client`, but model not present |
| `caseId` | objectId | check-in route | linked case |
| `person` | string | check-in route | display name |
| `county` | string | check-in route | county |
| `dueAt` | date | check-in route | due time |
| `timezone` | string | check-in route | timezone id |
| `officerId` | objectId | check-in route | ref to user |
| `method` | enum string | check-in route | `sms`, `call`, `app`, `in-person` |
| `status` | enum string | check-in route | `pending`, `overdue`, `done` |
| `note` | string | check-in updates | officer note |
| `contactCount` | number | check-in contact route | count of contacts |
| `lastContactAt` | date | check-in contact/attendance route | last contact time |
| `location.lat` | number | attendance route | GPS |
| `location.lng` | number | attendance route | GPS |
| `location.accuracy` | number | attendance route | GPS accuracy |
| `remindersEnabled` | boolean | check-in creation/update | reminders toggle |
| `gpsEnabled` | boolean | check-in creation/update | GPS toggle |
| `pingsPerDay` | number | check-in creation/update | schedule parameter |
| `lastPingAt` | date | ping scheduling/attendance | last ping |
| `scheduledWindowEnd` | date | declared only | no active writes confirmed |
| `meta.attendance.status` | string | attendance route | attendance substate |
| `meta.attendance.recordedAt` | date | attendance route | attendance timestamp |
| `meta.attendance.recordedBy` | mixed | attendance route | actor identity |
| `meta.attendance.note` | string | attendance route | note |
| `meta.attendance.location` | mixed | attendance route | payload |
| `meta.gpsJobs.queue` | string | queue service | queue name |
| `meta.gpsJobs.items[]` | object[] | queue service | scheduled ping jobs |
| `meta.gpsJobs.items[].jobId` | string | queue service | job id |
| `meta.gpsJobs.items[].scheduledFor` | date | queue service | time |
| `meta.gpsJobs.items[].ordinal` | number | queue service | sequence |
| `completedAt` | date | status update route | set when `done` |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `check_in_pings`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `checkInId` | objectId | check-in ping creation | ref to check-in |
| `clientId` | objectId | check-in ping creation | declared as ref to `Client`, but model not present |
| `scheduledFor` | date | ping creation | send time |
| `triggeredBy` | objectId | ping creation | ref to user |
| `triggeredByUid` | string | ping creation | user uid |
| `status` | enum string | ping creation/update | `queued`, `sent`, `acknowledged`, `missed`, `failed` |
| `channel` | enum string | ping creation | `sms`, `push`, `manual` |
| `responseAt` | date | declared only | no active writes confirmed |
| `location.lat` | number | attendance route | optional GPS |
| `location.lng` | number | attendance route | optional GPS |
| `location.accuracy` | number | attendance route | optional GPS |
| `payload` | mixed | declared only | no active writes confirmed |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `messages`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `caseId` | objectId | messaging service/routes | linked case |
| `personId` | objectId | messaging service | declared ref to `Person`, but model not present |
| `direction` | enum string | messaging service | `out`, `in` |
| `channel` | enum string | messaging service | `sms`, `voice` |
| `to` | string | messaging service | phone number |
| `from` | string | messaging service | phone number |
| `body` | string | messaging service | message content |
| `status` | enum string | messaging service and webhook handlers | `queued`, `sending`, `sent`, `delivered`, `failed` |
| `attempts` | number | messaging service | retry count |
| `scheduledAt` | date | messaging service | scheduled send |
| `sentAt` | date | messaging service | send time |
| `deliveredAt` | date | provider webhook | delivery time |
| `readAt` | date | declared only | no active writes confirmed |
| `provider` | string | messaging service | currently Twilio |
| `providerMessageId` | string | provider webhook | external message id |
| `errorCode` | string | failure handling | optional |
| `errorMessage` | string | failure handling | optional |
| `meta` | mixed | messaging service | freeform metadata |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `payments`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `transactionId` | string | payments route | unique transaction id |
| `externalReference` | string | declared only | no active writes confirmed |
| `amount` | number | payments route | payment amount |
| `currency` | string | defaulted model field | usually `usd` |
| `fees` | number | payments route and Stripe webhook | fee amount |
| `netAmount` | number | payments route and Stripe webhook | net amount |
| `method` | enum string | payments route | payment method |
| `status` | enum string | payments route and Stripe webhook | `pending`, `processing`, `completed`, `failed`, `refunded`, `disputed` |
| `description` | string | payments route | description |
| `bondNumber` | string | payments route | bond reference |
| `clientName` | string | payments route | client display name |
| `clientEmail` | string | payments route | client email |
| `clientId` | objectId | payments route | ref to user |
| `createdBy` | objectId | payments route | ref to user |
| `createdByUid` | string | payments route | creator uid |
| `stripePaymentIntentId` | string | payments route/webhook | stripe id |
| `stripeCustomerId` | string | Stripe sync | stripe customer |
| `stripeChargeId` | string | Stripe sync | stripe charge |
| `processedAt` | date | success webhook | completion time |
| `refundedAt` | date | refund webhook | refund time |
| `disputedAt` | date | dispute webhook | dispute time |
| `metadata` | map<string,string> | route and Stripe webhook | provider metadata |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `access_requests`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `email` | string | auth access-request route | requester email |
| `displayName` | string | auth access-request route | requester name |
| `message` | string | auth access-request route | request note |
| `status` | enum string | review route | `pending`, `reviewed`, `completed`, `rejected` |
| `reviewedBy` | objectId | review route | reviewer user id |
| `reviewedAt` | date | review route | review time |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `auth_audit`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `uid` | string | auth routes | user uid |
| `event` | enum string | auth routes | `session_created`, `session_failed`, `logout`, `session_revoked` |
| `email` | string | auth routes | user email |
| `ip` | string | auth routes | request ip |
| `userAgent` | string | auth routes | user agent |
| `metadata` | mixed | auth routes | event payload |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `jobs`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `name` | string | job creation | human-readable name |
| `kind` | string | job creation | normalize/scrape/audit style kind |
| `county` | string | job creation | county |
| `source` | string | job creation | source collection |
| `status` | enum string | job lifecycle | `queued`, `running`, `success`, `failed` |
| `queuedAt` | date | job creation | queued time |
| `startedAt` | date | job execution | start time |
| `finishedAt` | date | job execution | finish time |
| `attempts` | number | retry handling | count |
| `counts.seen` | number | job execution | processed total |
| `counts.inserted` | number | job execution | insert count |
| `counts.updated` | number | job execution | update count |
| `counts.skipped` | number | job execution | skipped count |
| `counts.errors` | number | job execution | error count |
| `error` | string | failure handling | message |
| `errorCode` | string | failure handling | code |
| `createdAt` | date | Mongoose timestamps or creation path | implicit/explicit hybrid |
| `updatedAt` | date | Mongoose timestamps or update path | implicit/explicit hybrid |

## Naming And Structure Inconsistencies

| Issue | Severity | Details |
|---|---|---|
| `Client` references without a visible `Client` model | high | `check_ins.clientId` and `check_in_pings.clientId` reference a model not present in repo |
| `messages.personId` references a missing `Person` model | high | declared relation has no local model backing |
| raw source contact fields at root plus CRM contact fields under `crm_details` | high | `address`/`phone` and `crm_details.address`/`crm_details.phone` duplicate the same concept |
| source case fields and CRM overlay fields coexist in `simple_*` | medium | one physical document mixes upstream normalized data and app-owned workflow state |
| multiple timestamp conventions | medium | some models rely on `timestamps`, others maintain explicit business timestamps |
| unused declared fields (`readAt`, `responseAt`, `payload`, `externalReference`, legal acceptance timestamps) | medium | schema surface is larger than actual writes |
| `assignedTo` stored as string instead of user ref | low | relation is denormalized compared with other user-linked fields |

## Canonical Schema Proposal

### Cases

Keep source-case and CRM overlay data conceptually separate even if they remain in the same collection.

```json
{
  "caseId": "objectId",
  "source": {
    "upsertKey": {
      "county": "string",
      "category": "string",
      "anchor": "string"
    },
    "fullName": "string",
    "county": "string",
    "charge": "string|null",
    "status": "string|null",
    "bookingDate": "string|null",
    "timeBucket": "string|null",
    "bond": {
      "amount": "number|null",
      "label": "string|null",
      "raw": "string|null"
    },
    "identifiers": {
      "caseNumber": "string|null",
      "spn": "string|null"
    },
    "contact": {
      "address": {
        "streetLine1": "string|null",
        "streetLine2": "string|null",
        "city": "string|null",
        "stateCode": "string|null",
        "postalCode": "string|null",
        "countryCode": "string|null"
      },
      "phone": "string|null"
    },
    "demographics": {
      "race": "string|null",
      "sex": "string|null"
    },
    "tags": ["string"]
  },
  "crm": {
    "stage": "new|contacted|qualifying|accepted|denied",
    "stageHistory": [
      {
        "stage": "string",
        "changedAt": "date",
        "actor": "string|null",
        "note": "string|null"
      }
    ],
    "notes": "string|null",
    "followUpAt": "date|null",
    "assignedToUserId": "objectId|null",
    "contact": {
      "address": {
        "streetLine1": "string|null",
        "streetLine2": "string|null",
        "city": "string|null",
        "stateCode": "string|null",
        "postalCode": "string|null",
        "countryCode": "string|null"
      },
      "phone": "string|null"
    },
    "documents": ["object"],
    "attachments": ["object"],
    "acceptance": {
      "accepted": "boolean",
      "acceptedAt": "date|null",
      "notes": "string|null"
    },
    "denial": {
      "denied": "boolean",
      "deniedAt": "date|null",
      "reason": "string|null",
      "notes": "string|null"
    },
    "manualTags": ["string"]
  }
}
```

### Users

Keep `uid`, `email`, `roles`, `departments`, `counties`, `status`, and `mfaEnforced` as the stable core. Only retain policy-acceptance timestamps if the product actually writes them.

### Check-ins and pings

Replace `clientId` with a clear stable reference name, for example `subjectUserId` or remove it if the relation is not real. Use `assignedOfficerId` instead of a freeform parallel string when feasible.

### Messages

Remove or replace `personId` unless a real `Person` collection exists in this repo. If the requirement is just a display name, store `personName` as a string.

### Payments

Keep `transactionId`, `amount`, `status`, `method`, Stripe ids, and actor references as the stable core. Deprecate `externalReference` if it remains unused.

## Recommended Normalization Changes

1. Separate source-case fields and CRM overlay fields logically in code, even if they share one Mongo document.
2. Normalize all address structures to one shared address schema.
3. Replace missing-model refs (`Client`, `Person`) with real refs or plain scalar fields.
4. Standardize business timestamps on top of `createdAt`/`updatedAt` rather than mixing several patterns casually.
5. Remove declared-but-unused fields after confirming no external dependency uses them.