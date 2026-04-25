# Payments QA Checklist

_Last updated: 2025-01-15_

This script should be executed whenever we touch the payments stack (UI, API, Stripe config) or before a release. It assumes the dev server is running (`npm run dev` + `npm run server:dev`), Stripe CLI forwarding webhooks, and Firebase auth configured with a SuperUser.

## Preconditions
- Stripe test keys present in `.env` / `server/.env` and match the current CLI session.
- Mongo `payments` collection reachable and empty or noted prior to testing.
- Test user with `billing:manage` role available (e.g., `ryan@vintaragroup.com`).
- Browser cache cleared or hard refresh performed before the run.

## Test Matrix
| # | Area | Steps | Expected |
|---|------|-------|----------|
| 1 | Navigation | From main nav select **Payments** → ensure Billing dashboard renders metrics without console errors. | Dashboard shows zero-state cards; network requests resolve 200/404 as stubbed. |
| 2 | Process Payment (card) | Click **Process Payment** quick action. Enter `Ryan Morrow`, amount `42.00`, email `qa+card@asapbail.com`, case `BB-2024-01`, notes optional. Use Stripe test card `4242 4242 4242 4242`. Submit. | Toast: “Payment submitted”. Browser routes to `/payments/confirmation?transactionId=…`. Confirmation view shows $42.00 amount, fees, totals. |
| 3 | API persistence | In network tab inspect `POST /api/payments` response (202). Verify `payment.transactionId` matches confirmation URL. Check Mongo (`db.payments.find({transactionId:"..."}).pretty()`). | Mongo record status `processing`. Amount `42`. Metadata includes `serviceFee`, `processingFee`. |
| 4 | Webhook update | Observe Stripe CLI output for `payment_intent.succeeded`. Refresh Billing dashboard. | Payment row appears in Recent Transactions with status `completed`; Mongo document `status` updated, `processedAt` populated, `stripeChargeId` present. |
| 5 | Refund Flow (optional) | `POST /api/payments/:id/refund` via Swagger UI with partial amount (e.g., `10`). | API returns 202; Mongo document status `refunded`; Stripe dashboard shows refund. |
| 6 | Error handling | Attempt to submit form missing email (with Stripe key configured). | Toast shows validation error “Provide client name, email, and amount…”. No API call fired. |
| 7 | Access control | Login as non-billing role (e.g., standard employee). Hit `/payments`. | API responds 403; UI shows access denied message (or redirect). |
| 8 | Regression smoke | Run `npm run build` (frontend) and `npm run server start` locally to ensure production artifacts compile. | Build completes without warnings; homepage loads and payments routes continue to function with Stripe Elements.

## Sign-off
Record tester name, date, Stripe CLI signing secret, and any deltas in `docs/PAYMENT_INTEGRATION_REQUIREMENTS.md` progress log.
