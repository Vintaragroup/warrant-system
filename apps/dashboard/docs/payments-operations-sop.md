# Payments Operations SOP (Refunds, Disputes, Monitoring)

_Last updated: 2025-01-15_

## 1. Roles & Access
- **SuperUser / BillingManager** roles may issue refunds, respond to disputes, and view full transaction history.
- Standard staff may submit refund *requests* only via UI (coming soon) and cannot see card metadata.
- Access is enforced through `billing:read` / `billing:manage` permissions and stored in `users.roles`.

## 2. Refund Workflow
1. Locate the transaction in `/payments/history` or Mongo (`payments` collection) using `transactionId`.
2. Confirm payment status is `completed` and verify eligibility:
   - `refundEligible` endpoint should include the transaction OR manual check that amount > fees and not already refunded.
   - Collect approval if amount > configured threshold (`paymentSettings.approvalThreshold`, default $5,000).
3. Execute refund:
   - Preferred: use UI action (pending implementation) or call `POST /api/payments/:transactionId/refund` with JSON `{ "amount": <partial or full>, "reason": "Customer request" }`.
   - API validates presence of Stripe payment intent and translates dollars → cents.
4. Confirmation:
   - API responds 202 with `refund.status`.
   - Stripe Dashboard should show new Refund record tied to the charge.
   - Mongo document updates: `status` → `refunded`, `refundedAt` timestamp, `metadata.lastRefundId` storing Stripe refund id.
5. Notify client:
   - Email receipt through Stripe Dashboard or CRM template.
   - Update case notes with refund reason and amount.

## 3. Dispute Response
1. Stripe will send `charge.dispute.created` webhooks (handler already installed).
2. Monitoring:
   - Webhook handler stores dispute metadata in `payments` record (`status` -> `disputed`, `disputedAt`, metadata `disputeReason`).
   - Dashboard `/payments/disputes` view surfaces active disputes (UI uses `usePaymentDisputes`).
3. Response steps:
   - Collect evidence (bond contract, payment authorization) within Stripe Dashboard.
   - Update `metadata.disputeNotes` via UI or direct Mongo update for internal tracking.
   - Resolve via Stripe Dashboard or API. Once resolved, mark as such through `/api/payments/disputes/:id/resolve` (updates local record to `completed`).
4. Documentation:
   - Store evidence bundle in secure document store.
   - Record resolution outcome in Payment record notes and case file.

## 4. Monitoring & Alerts
- **Stripe CLI / Webhook health**
  - Production must use hosted webhook endpoint (no CLI) with Stripe Dashboard alert configured for failure rate > 3%.
  - Add uptime monitor (e.g., Pingdom) hitting `/api/health`.
- **Log aggregation**
  - Ensure API logs (including payment errors) are shipped to central logging (e.g., Datadog) with alert on `StripeAuthenticationError` or `Webhook Error` messages.
- **Reconciliation**
  - Daily job to compare Stripe payouts vs. Mongo transaction totals. Export using `/api/payments/metrics` and Stripe balance transactions.
  - Investigate discrepancies > $5.

## 5. Incident Response
1. Payment failure rate spikes above 5% or webhook failures escalate → page BillingManager + DevOps.
2. Collect recent logs, Stripe event ids, and submit to Stripe support if necessary.
3. Temporarily disable payment form (feature flag) if outage spans > 30 minutes.
4. Communicate with affected clients; manual processing available via Stripe Dashboard virtual terminal.

## 6. Audit & Compliance
- Store Stripe keys in secrets manager; rotate quarterly.
- Export monthly report of refunds/disputes for SOC2 evidence.
- Capture QA run artifacts (console logs, Stripe CLI output) and attach to release ticket.
