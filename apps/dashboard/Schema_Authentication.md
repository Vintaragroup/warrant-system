# Schema Authentication Reference

_Last updated: 2025-01-13_

## 1. Purpose
Maintain a security-focused, living reference for all identity and access management (IAM) data structures, configuration touchpoints, and integration contracts while implementing Firebase Authentication for the Bail Bonds Dashboard. The document enforces compliance with organization security policy, OWASP ASVS L2, and any applicable justice-related regulations (e.g., CJIS-style safeguards) during design and implementation.

## 2. Scope, Standards & Dependencies
- Applies to the Firebase Authentication tenant configured per `docs/authentication-integration.md`.
- Covers MongoDB collections that persist user profile, role, audit, and secrets metadata.
- Integrates with case-management schemas defined in `SCHEMA_CONTRACT.md` and any future data warehouses.
- Security benchmarks referenced:
  - OWASP Application Security Verification Standard (ASVS) v5.0 Level 2 for authentication/authorization controls.
  - NIST 800-63B (Digital Identity Guidelines) for authenticator assurance and MFA.
  - SOC 2 Type II (Common Criteria CC1.1–CC10, plus CC6/CC7 for access/logging) for access control, monitoring, change management, and evidence collection.
  - CJIS-like access controls for law-enforcement-adjacent data handling (least privilege, audit).
  - Organization-wide policies: data classification, incident response, logging, and retention standards.

## 3. Data Classification & Protection Requirements
| Data Element | Location | Classification | Protection Requirements |
| ------------ | -------- | -------------- | ----------------------- |
| Firebase UID | Firebase, Mongo `users` | Internal Sensitive | Encrypt in transit, store hashed or opaque where possible. |
| Email | Firebase, Mongo `users` | PII | TLS 1.2+, encryption at rest, unique index, avoid logging raw values. |
| MFA Factors | Firebase | Confidential | Never persisted outside Firebase; only store boolean `mfaEnforced`. |
| Roles/Departments | Mongo `users` | Internal Sensitive | Restrict access to Admin/SuperUser, audit changes. |
| Audit Metadata (IP, device) | Mongo `authAudit` | Internal Sensitive | Retain ≤ 400 days unless legal hold, mask IPs in analytics exports. |
| Provider Tokens | Client-side only | Secret | Never persist server-side; exchange for session tokens if needed. |

- **Encryption in transit:** All communication between client ↔ Firebase ↔ Express ↔ MongoDB uses TLS/SSL. Enforce HTTPS-only cookies and HSTS for production domains.
- **Encryption at rest:** Firebase-managed keys; MongoDB deployment must enable at-rest encryption (e.g., WiredTiger + disk encryption) per infrastructure policy.
- **Secrets handling:** Service account JSON stored in secrets manager; environment variables injected at runtime; no secrets in Git.

## 4. Entity Catalog

### 4.1 Firebase User (Managed)
- **Source:** Firebase Authentication.
- **Primary Key:** `uid` (string).
- **Attributes:**
  - `email` (string, unique, verified flag)
  - `displayName` (string)
  - `phoneNumber` (string, optional)
  - `providerData[]` (linked identity providers; see Section 7)
  - `multiFactor.enrolledFactors[]` (MFA enrollment state)
  - `customClaims` (dictionary for coarse-grained flags; avoid sensitive data)
  - `metadata.lastSignInTime`, `metadata.creationTime`
- **Security Notes:**
  - Disable legacy password sign-in if using passwordless-only flows.
  - Require email verification before granting non-BondClient roles.
  - Leverage Firebase blocked users list for breach lockouts.

### 4.2 MongoDB `users` Collection (Authoritative Profile)
```json
{
  "uid": "firebase-uid",             // string, required, indexed, unique
  "email": "user@example.com",        // string, lowercase, indexes for lookup
  "roles": ["Admin"],                  // array<string>, from Roles table
  "departments": ["North"],            // array<string>, aligns with SCHEMA_CONTRACT.md departments
  "mfaEnforced": true,                 // boolean, signals backend policy
  "status": "active",                 // enum: active | suspended | invited | pending_mfa | deleted
  "lastLoginAt": ISODate,              // mirrored from Firebase metadata
  "invitedBy": ObjectId("..."),        // ref to MongoDB user who sent invite
  "termsAcceptedAt": ISODate,          // compliance acknowledgement
  "privacyNoticeAcceptedAt": ISODate,  // optional, for CJIS/GDPR-like tracking
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```
- **Indexes:**
  - `{ uid: 1 }` unique.
  - `{ email: 1 }` unique partial (case-insensitive) where `status != 'deleted'`.
  - Compound `{ roles: 1, status: 1 }` to speed admin dashboards.
  - TTL index for soft-deleted records if policy requires purge after N days.
- **Constraints:**
  - `roles` must contain at least one value; defaults to `['BondClient']` on self-registration.
  - `departments` required for `DepartmentLead`, `Employee`, `Sales` (validated backend).
  - `SuperUser` role assignment requires explicit dual-approval workflow (tracked in audit).

### 4.3 MongoDB `roles` Reference (Config Collection or Static JSON)
```json
{
  "name": "Admin",
  "permissions": [
    "cases:view",
    "cases:edit",
    "users:invite",
    "reports:view"
  ],
  "inherits": ["Employee"],
  "description": "Full operational control minus super-user overrides",
  "mfaRequired": true,                   // enforce strong auth by role
  "allowedDepartments": "*",           // optional constraint
  "riskLevel": "high"                   // aids review cadence
}
```
- Maintain schema migration script to update permissions atomically; log diff to `authAudit`.

### 4.4 MongoDB `authAudit` Collection
```json
{
  "uid": "firebase-uid",
  "event": "login_success",            // enum: login_success, login_failure, role_change, mfa_challenge, provider_link, policy_violation, suspension
  "actor": "uid|system",
  "metadata": {
    "ip": "203.0.113.5",
    "userAgent": "Mozilla/5.0 ...",
    "previousRoles": ["Employee"],
    "newRoles": ["DepartmentLead"],
    "reason": "Promotion"
  },
  "createdAt": ISODate,
  "correlationId": "uuid"
}
```
- **Indexes:** `{ uid: 1, createdAt: -1 }`, `{ event: 1, createdAt: -1 }`, `{ correlationId: 1 }`.
- **Retention:** 400 days minimum; extend per legal or incident response. Export sanitized logs to SIEM weekly.
- **PII Minimization:** Hash IP before storage if policy mandates (`sha256(ip + salt)`).

### 4.5 MongoDB `sessionRevocations` (Optional)
```json
{
  "uid": "firebase-uid",
  "reason": "credential_compromise",
  "revokedAt": ISODate,
  "revokedBy": "uid|system"
}
```
- Use to coordinate server-side session invalidation when rotating credentials or responding to incidents.

## 5. Role Definitions & Governance
| Role | Description | Mandatory MFA | Department Scope | Review Cadence | Notes |
| ---- | ----------- | ------------- | ---------------- | -------------- | ----- |
| SuperUser | IT/Dev break-glass | Yes (TOTP + device) | Global | Quarterly access review | Can manage providers, bypass RBAC with dual audit |
| Admin | Operational administrators | Yes | Global | Quarterly | Cannot modify provider credentials |
| DepartmentLead | Manages team cases | Recommended | Scoped | Semi-annual | Can invite Employees in same department |
| Employee | Case worker | Optional | Scoped | Annual | CRUD within assigned dept |
| Sales | Sales staff | Optional | Scoped | Annual | Limited data export rights |
| BondClient | Client self-service | Optional | Self-only | N/A | Read-only except document upload |

- **Access Review Procedure:** SuperUser triggers quarterly review; exports role membership, obtains department lead attestation, records in GRC system.
- **Emergency Access:** Temporary elevation allowed for 24h with ticket reference; automatically reverts via scheduled job.

## 6. Provider Linkage Matrix & Policies
| Provider | Firebase Provider ID | Required Config | Stored Metadata | Security Controls |
| -------- | -------------------- | ---------------- | --------------- | ---------------- |
| Email/Password | `password` | Enabled, password policy (min length 12, breach check) | `email`, `emailVerified` | Force password reset on known compromise; rate-limit sign-in. |
| Email Link | `emailLink` | Action URL, dynamic link | `email`, `lastSignInTime` | Links expire in ≤15 minutes; single-use. |
| Google | `google.com` | OAuth consent screen, web client ID | `providerId`, `federatedId`, `photoURL` | Limit scopes to `profile email`; monitor token refresh failures. |
| Apple | `apple.com` | Apple Service ID, team key, domain association | `providerId`, `displayName` | Maintain Apple private key rotation schedule (12 months). |
| Others (optional) | `...` | As required | Extend schema | Security review required before enablement. |

## 7. API Contracts (Security Considerations)
- **`POST /api/auth/session`**
  - Input: Firebase ID token.
  - Output: HTTP-only, Secure, SameSite=strict cookie.
  - Security: Validate token audience, issuer; throttle attempts (5/min/IP); rotate session cookie key every 30 days.
- **`GET /api/auth/me`**
  - Response: `{ uid, email, roles, departments, mfaEnforced, termsAcceptedAt }`.
  - Security: Cache-control `no-store`; log access with correlation ID.
- **`POST /api/users`** (Admin only)
  - Require CSRF token for cookie-auth flows; verify input against allowlist (roles, departments).
  - Trigger notification to Security if SuperUser role assigned.
- **`PATCH /api/users/:uid/roles`**
  - Enforce optimistic concurrency using `updatedAt`.
  - Log diff in `authAudit`, send webhook to SIEM.
- **`POST /api/users/:uid/revoke-sessions`** (new)
  - Invalidates refresh tokens via Firebase Admin `revokeRefreshTokens(uid)`.

## 8. Data Flow Scenarios & Security Controls
1. **New Bond Client Signup**
   - Firebase email verification required before enabling case access.
   - Backend sanitizes input, ensures default role only, logs `authAudit` event with `event: 'signup'`.
2. **Staff Invite**
   - Invitation token limited to 72h; require MFA enrollment on first login if `mfaEnforced` true.
   - Backend records inviter UID and ticket number for audit.
3. **Role Change**
   - Dual authorization required for SuperUser changes (requester + approver recorded in metadata).
   - Email notification sent to affected user with support contact.
4. **Provider Link (Google)**
   - Session reauthentication required (Firebase requires recent login <5 minutes).
   - On unlink, ensure no orphaned roles remain; fallback to email login.
5. **Account Suspension**
   - Server sets `status:'suspended'`, revokes Firebase refresh tokens, and blocks via Admin SDK.

## 9. Validation & Enforcement Rules
- Input validation performed server-side with Zod schemas.
- `mfaEnforced === true` requires Firebase `multiFactor.enrolledFactors.length > 0`; otherwise block access and prompt enrollment.
- Deny access if `status` in (`suspended`, `deleted`).
- JWT verification uses certificate pinning (cache Firebase JWKS, validate kid).
- Rate limiting: 100 login attempts/IP/hour; 10 password reset requests/email/hour.
- Brute force detection: integrate Firebase `beforeSignIn` trigger (optional Cloud Function) to enforce IP reputation checks.

## 10. Monitoring, Logging & Alerting
- Centralize authentication logs in SIEM with alert thresholds for:
  - ≥5 failed logins for same UID/IP within 15 minutes.
  - Role change events for SuperUser/Admin.
  - MFA reset events.
- Maintain dashboard for active sessions, invites, and lockouts.
- Integrate with on-call rotation: critical auth alerts page Security within 5 minutes.

## 11. Incident Response & Disaster Recovery
- **Compromise Workflow:**
  1. Revoke affected user sessions via `revokeRefreshTokens`.
  2. Set `status:'suspended'`, document incident ticket.
  3. Rotate secrets (service account key, OAuth secrets) if necessary.
  4. Review `authAudit` logs, export for forensics.
- **Backup Strategy:**
  - MongoDB backups daily; verify `users`, `roles`, `authAudit` collections included.
  - Test restoration quarterly to ensure RBAC integrity persists.
- **Failover:** Document manual login fallback (admin contact, offline verification) if Firebase outage occurs.

## 12. Change Management & Compliance Review
- Update this document alongside schema migrations or security policy updates.
- Maintain change log with author, summary, associated ticket.
- Map updates to SOC 2 control evidence (e.g., CC6.1 access provisioning, CC7.2 monitoring, CC8.1 change management) and archive approvals in GRC system.
- Security team performs annual review to ensure alignment with evolving standards and regulator guidance.

## 13. Implementation Task Checklist (Security-Critical)
- **Governance & Access Control**
  1. Approve Firebase project creation in GRC system; record owner and recovery contacts.
  2. Configure provider policies per Section 6; attach evidence (screenshots/config export) to SOC 2 CC6.1 record.
  3. Seed `roles` collection with permissions/mfa requirements; peer review mapping against least-privilege matrix.
  4. Bootstrap SuperUser account; verify MFA and store dual-approval record.
- **Backend Integration**
  5. Install `firebase-admin`, implement token verification middleware, and add automated tests covering success/failure paths.
  6. Extend Mongo schemas (`users`, `authAudit`, optional `sessionRevocations`); run migration with back-out plan.
  7. Implement role-based middleware and session revocation endpoint; document API contracts in OpenAPI.
  8. Configure logging export to SIEM; validate alert rules (failed logins, role changes).
- **Frontend & Client Security**
  9. Install `firebase` SDK, implement login/MFA flows consistent with UX specs.
  10. Enforce secure storage of ID tokens (HTTP-only cookie or in-memory); add CSRF protections if cookies used.
  11. Integrate re-authentication prompts for sensitive operations (role change, MFA enrollment).
- **Operational Readiness**
  12. Document support runbooks (password reset, MFA reset, account suspension) and store in knowledge base.
  13. Conduct tabletop incident response exercise simulating credential compromise.
  14. Complete end-to-end security testing (Firebase emulator, penetration test focus, SOC 2 evidence capture).
  15. Obtain security sign-off prior to production release; archive approvals with deployment ticket.

### Changelog
- 2025-01-13 – Initial draft (Codex) covering Firebase integration schema.
- 2025-01-13 – Security compliance revisions (Codex): added data classification, access governance, provider controls, monitoring.
- 2025-01-13 – SOC 2 alignment (Codex): incorporated SOC 2 Type II references and evidence tracking guidance.
- 2025-01-13 – Implementation checklist (Codex): added security-critical task list for execution tracking.

---
For implementation steps, see `docs/authentication-integration.md`.
