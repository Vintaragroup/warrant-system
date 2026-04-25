# Final Feature Readiness Tracker

_Last updated: 2025-01-15_

## 1. Objective
Track the remaining feature work required before we containerize and promote the application to staging. The immediate focus is on the payments experience (Billing & Payments dashboard, transaction workflows), followed by check-ins, calendar, messaging, and reporting.

## 2. Feature Snapshot
| Feature Area | Pages / Views | Current Status | Key Dependencies | Notes |
| --- | --- | --- | --- | --- |
| Payments | Billing Dashboard, Payment Form, Methods, Confirmation, History, Settings, Refunds, Disputes | ✅ Feature work complete – awaiting containerization/staging rollout tasks | Payment processor SDK, secure vault for keys, transaction schema | Monitoring/SOC2 evidence will be finalized during infrastructure deployment. |
| Check-ins | Check-in scheduler, attendance log, compliance alerts | In progress – scheduling modal + attendance API live; reminders/GPS queue outstanding | Calendar utilities, notification service | Should follow payments to leverage shared scheduling primitives. |
| Calendar | Global schedule, court dates, staff allocation | Design assets ready; no data plumbing yet | Time-zone handling, ICS export optional | Supports both check-ins and case management. |
| Messages | Inbox, templates, automated reminders | Backend queue + API wired; awaiting Twilio credentials, thread UI, and compliance artifacts | Notification gateway (Twilio, SendGrid, etc.) | See `docs/messaging-sms-integration.md` for detailed task list and compliance notes. |
| Reports | KPI overview, export to CSV/PDF | Data queries partially covered by dashboard APIs | Reporting engine, role-based data filtering | Align with SOC2 evidence requirements. |

## 3. Payments Implementation Plan
1. **Data + API Foundations**
   - Define `Payment` schema (Mongo) with transaction references, status enum, audit timestamps.
   - Expose `/api/payments` endpoints (list, detail, create, refund, dispute) and secure with role checks.
   - Extend Swagger spec for new routes.
2. **Processor Integration**
   - Select provider (see §5) and implement server-side webhooks for payment events.
   - Store processor customer/payment method IDs; rely on provider vault for PCI scope reduction.
   - Map webhook events to internal state transitions (`pending` → `completed`/`failed`).
3. **Frontend Wiring**
   - Connect Billing Dashboard metrics to `/api/payments/metrics` endpoint.
   - Implement Payment Form with tokenized card entry; use provider SDK (Stripe Elements or similar).
   - Surface transaction tables (paged queries, filters) and quick actions (refund, disputes).
4. **Security & Compliance**
   - Enforce TLS-only communication; no card data persisted locally.
   - Configure role-based visibility (finance/admin only) and audit logging.
   - Update `Schema_Authentication.md` with payment roles (e.g., BillingManager).
5. **Testing & QA**
   - Unit tests for payment service + webhook handlers.
   - End-to-end happy-path: create payment, refund, dispute resolution.
   - Negative scenarios: declined card, webhook replay, unauthorized access.
6. **Documentation & Training**
   - Playbooks for operations (refund policy, dispute flow).
   - Update go-live checklist with payment gateway credentials and runbooks.

## 4. Payments Checklist (Pre-Staging)
- [x] Choose processor and obtain sandbox credentials. *(Stripe test workspace + restricted key configured 2025-01-15.)*
- [x] Implement backend payment models, CRUD endpoints, and service layer.
- [x] Configure webhook endpoint with signature validation. *(Validated via Stripe CLI listener 2025-01-15; live endpoint to be added post-deploy.)*
- [x] Wire frontend components (dashboard widgets, transaction list, forms) to API responses.
- [x] Add environment variables to `.env.example` (API keys, webhook secret, currency settings).
- [x] Write automated tests (unit + integration) and add manual QA script.
- [x] Document refund/dispute SOP and share with operations. *(See `docs/payments-operations-sop.md`.)*
- [ ] Capture SOC2 evidence: architecture diagram, data flow, control owners sign-off. *(In progress – evidence folder to be compiled.)*

## 5. Provider Comparison & Recommendation
| Provider | Typical Fees* | Integration Effort | Feature Highlights | Considerations |
| --- | --- | --- | --- | --- |
| **Stripe** | 2.9% + $0.30 (cards); ACH ~0.8% capped at $5 | Low — mature REST API, SDKs, prebuilt UI (Elements) | Cards, ACH, payment links, subscription support, hosted onboarding | Requires PCI SAQ-A compliance only (tokenized); instant sandbox; strong dispute tooling. |
| **Clover** | ~2.6% + $0.10 (depends on plan) + monthly hardware/app fees | Medium/High — designed for POS; API access requires partner program | Hardware terminals, in-person focus, inventory tools | Better for retail storefronts; online API access limited; higher fixed costs. |
| **Square** | 2.6% + $0.10 (card-present), 2.9% + $0.30 (card-not-present) | Medium — good web SDKs, but less flexibility than Stripe | POS + online, invoicing, virtual terminal | Useful if in-person payments dominate; developer tooling improving but fewer advanced workflows. |
| **PayPal / Braintree** | 2.9% + $0.30 | Medium — solid APIs, hosted checkout | PayPal wallet, cards, vault | Fees similar to Stripe; broader customer recognition; dispute process more manual. |

\*Fees vary by volume/industry; negotiate for lower rates once transaction volume is known.

**Recommendation:** Start with **Stripe** for staging/production. It offers the fastest path to market, excellent developer tooling, ACH support (useful for bond payments), automated dispute handling, and easy SOC2 evidence (audit logs, PCI compliance documentation). Loop back to evaluate Clover/Square if physical terminal integration becomes mandatory.

## 6. Best Practices for Payments Feature
- Tokenize payment instruments; never log PAN or CVV.
- Serve all payment pages over HTTPS and enforce HSTS.
- Store minimal PII; link transactions via internal IDs for audit.
- Log payment lifecycle events with correlation IDs for reconciliation.
- Implement idempotency keys on payment creation to prevent duplicates.
- Rate-limit sensitive endpoints (refunds, disputes) and enforce MFA for finance roles.
- Set up monitoring and alerting on webhook failure rates and chargeback thresholds.
- Regularly reconcile processor payouts with internal ledger; consider nightly jobs.

## 7. Next Up After Payments
1. **Check-ins (priority):**
   - Wire generated UI components to existing case/check-in APIs.
   - Implement check-in creation/edit modals with validation, officer assignment, and location/timezone handling.
   - Add reminder delivery hooks (email/SMS placeholders) + audit logging for attendance outcomes.
   - Build list/detail views with filters (status, upcoming vs missed) and React Query integration.
2. **Messaging:**
   - Provision Twilio sandbox credentials and validate end-to-end send/receive flows.
   - Extend messaging API with thread view, scheduling, and opt-out enforcement.
   - Flesh out frontend conversation UX (thread viewer, template CRUD, retry flows).
   - Document opt-in/opt-out, retention, and monitoring runbooks ahead of staging cutover.
3. **Calendar:** merge case events, check-ins, and court dates with timezone-aware components.
4. **Reports:** finalize data sources, build export flows, integrate with go-live compliance checklist.

## 8. Progress Log
- **2025-01-15:** Added `/api/payments` route family with placeholder data, updated role permissions (`billing:*`), published OpenAPI schemas, and introduced `Payment` model scaffold for upcoming Stripe integration.
- **2025-01-15:** Connected payment UI screens to backend stubs (React Query hooks for metrics, history, methods, refunds, disputes), replacing mock data and enabling toast-driven mutation flows.
- **2025-01-15:** Replaced legacy `/payments` page with routed billing dashboard + sub-pages (`/payments/*`), so authenticated users access the new payment experience directly.
- **2025-01-15:** Bootstrapped Stripe integration (env keys, SDK helper, webhook route, PaymentIntent creation) and wrapped payments UI with a Stripe Elements provider for future card entry flows.
- **2025-01-15:** Enabled live Stripe test flows in `PaymentForm` using CardElement + `confirmCardPayment`, with fallbacks for non-Stripe setups.
- **2025-01-15:** Captured Stripe integration baseline in git/docs after updating env templates, lockfiles, and Elements wiring; next focus is webhook QA + automated testing.
- **2025-01-15:** Ran Stripe CLI end-to-end payment test (TXN-2025-*), fixed confirmation view to use persisted totals, and confirmed Mongo/Stripe records match.
- **2025-01-15:** Published payments QA checklist & operations SOP, outlined automated test suite plan to close out remaining checklist items.
- **2025-01-15:** Landed automated payment tests (Vitest/RTL + Supertest) and documented webhook monitoring/SOC2 evidence expectations.
- **2025-01-15:** Kicked off check-ins refresh—added dedicated UI components, refactored `/check-ins` page to new layout, expanded hooks, and delivered first API updates (schema, timeline, create/update, manual ping).
- **2025-01-15:** Wired check-in creation to live case/officer options, stored case metadata, and added `/checkins/:id/attendance` flow (UI + OpenAPI). Next: reminder queue + missed-check-in handling.

---
Primary owner: Application Engineering. Update this tracker as each milestone is completed.
