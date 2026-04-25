# Payment System Integration Requirements

## Overview

This document outlines the implementation requirements for integrating the comprehensive payment processing system into the existing Bail Bonds Dashboard application. The payment system consists of 8 core components that follow the established design system and authentication patterns.

## Current Implementation Status

### ✅ Completed Components

All payment components have been implemented with `.jsx` extensions:

- **BillingDashboard.jsx** - Main payment overview and navigation hub
- **PaymentMethods.jsx** - Payment method management and selection
- **PaymentForm.jsx** - Secure payment processing form
- **PaymentConfirmation.jsx** - Transaction confirmation and receipt
- **PaymentHistory.jsx** - Transaction history with filtering and export
- **PaymentSettings.jsx** - Payment configuration and preferences
- **RefundProcessing.jsx** - Refund management and processing
- **PaymentDisputes.jsx** - Dispute tracking and resolution

### ✅ Already Integrated

- All payment components imported in `App.tsx`
- Navigation system updated with payment screen types
- Design system consistency maintained
- Demo navigation dropdown includes payment section
- Payment screens now consume live React Query hooks backed by `/api/payments/*` placeholder routes
- `/payments/*` routes added to the authenticated app shell, exposing Billing Dashboard, methods, history, settings, refunds, and disputes in production navigation.
- Stripe integration scaffolding added: server-side PaymentIntent creation, webhook endpoint, and a Stripe Elements provider wrapping the payments UI (card capture onboarding still in progress).
- Stripe Elements CardElement is now live on the Payment Form; submissions call `confirmCardPayment` with the client secret returned by `/api/payments`.

## Required Updates

### 1. File Extension Consistency

**Status**: ⚠️ **Partial** - Auth components still use `.tsx`

**Action Required**:
```bash
# Convert remaining .tsx auth components to .jsx
# Update import statements in App.tsx to use .jsx extensions
```

**Files to Convert**:
- `/components/auth/*.tsx` → `/components/auth/*.jsx`
- Update all import statements in `App.tsx`

### 2. Component Navigation Integration

**Status**: ✅ **Complete** - Navigation already integrated

**Verification Needed**:
- Test all `onNavigate` prop callbacks
- Verify smooth transitions between auth and payment flows
- Confirm proper state management during navigation

### 3. User Context Integration

**Status**: ⚠️ **Needs Verification**

**Requirements**:
- Ensure payment components can access user authentication state
- Verify user roles/permissions for admin-level payment functions
- Test session persistence across payment flows

**Key Integration Points**:
```jsx
// Payment components should access user context for:
// - User identification in transactions
// - Permission-based feature access
// - Session validation for secure operations
```

### 4. Design System Dependencies

**Status**: ✅ **Complete** - All UI components available

**Verified Dependencies**:
- Tailwind V4 configuration with custom color tokens
- ShadCN UI components library
- Custom PillButton component
- Lucide React icons
- Recharts for payment analytics

### 5. Latest Progress (2025-01-15)
- Stripe server/client SDKs installed and committed with updated lockfiles.
- `/api/payments` routes now create PaymentIntents, process refunds, and react to Stripe webhooks.
- Payments UI runs inside Stripe Elements; `PaymentForm` confirms intents with live test keys when present.
- `.env.example` files include `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `VITE_STRIPE_PUBLISHABLE_KEY` placeholders.
- Stripe CLI webhook run (`stripe listen --forward-to http://localhost:8080/api/payments/stripe-webhook`) validated the processing flow with test card 4242…; payment document moved to `completed` and confirmation screen now reflects stored totals.
- Next up: add webhook monitoring/alerting and finalize PCI/SOC2 evidence package.
- Vitest and Supertest harnesses added with initial smoke tests (`PaymentForm` validation + `/api/payments` intent creation`).

## Backend Integration Requirements

### API Endpoints Needed

**Payment Processing** (current implementation)
```
POST /api/payments                 # creates a Stripe PaymentIntent and returns { payment, clientSecret }
POST /api/payments/:id/refund      # issues a refund via Stripe
POST /api/payments/stripe/webhook  # receives Stripe event callbacks (raw payload)
```

**Payment Management**
```
GET  /api/payments                 # paginated payment list
GET  /api/payments/metrics         # dashboard summary
GET  /api/payments/methods         # placeholder list until Stripe customer vault is wired
GET  /api/payments/settings        # retrieve billing settings
PUT  /api/payments/settings        # update billing settings
GET  /api/payments/refunds/eligible
GET  /api/payments/refunds/requests
GET  /api/payments/disputes
POST /api/payments/disputes/:id/resolve
```

### Data Models Required

**Payment Transaction**:
```typescript
interface PaymentTransaction {
  id: string;
  amount: number;
  method: 'credit-card' | 'bank-transfer' | 'wire' | 'check';
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  bondNumber: string;
  clientName: string;
  date: Date;
  fees: number;
}
```

**Payment Method**:
```typescript
interface PaymentMethod {
  id: string;
  type: 'credit-card' | 'bank-account';
  last4: string;
  expiryDate?: string;
  isDefault: boolean;
  isActive: boolean;
}
```

### Security Requirements

**PCI Compliance**:
- Implement tokenization for payment methods
- Ensure secure transmission of payment data
- Add audit logging for all payment operations
- Verify Stripe webhook signatures (`STRIPE_WEBHOOK_SECRET`) and never log raw card data.

**Authentication Integration**:
- Verify user authentication before payment processing
- Implement role-based access for admin functions
- Add session validation for sensitive operations

## Testing Requirements

### Unit Tests Needed

**Component Testing**:
```
/tests/payments/
├── BillingDashboard.test.jsx
├── PaymentForm.test.jsx
├── PaymentHistory.test.jsx
├── PaymentSettings.test.jsx
├── RefundProcessing.test.jsx
└── PaymentDisputes.test.jsx
```

**Key Test Scenarios**:
- Form validation and error handling
- Navigation flow between components
- User permission-based feature access
- Mock API integration
- Responsive design verification

### Integration Tests

**Payment Flow Testing**:
- End-to-end payment processing
- Refund workflow validation
- Dispute resolution process
- Export functionality
- Settings persistence

## Environment Configuration

### Required Environment Variables

```env
# Backend
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Frontend
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx

# Existing Firebase + session variables remain in `.env.example` / `server/.env.example`
```

### 6. QA & Operations Assets
- **Manual QA script:** `docs/payments-qa-checklist.md` (card flow, webhook verification, access control).
- **Operations SOP:** `docs/payments-operations-sop.md` (refunds, disputes, monitoring).
- **Automated tests:** Vitest + RTL smoke test for `PaymentForm`, Vitest + Supertest units for payment creation/refund/dispute handlers.

#### Automated Test Coverage Plan
- Component tests (PaymentForm, history widgets) using React Testing Library + jsdom.
- React Query hooks mocked via MSW for `/api/payments` endpoints. *(todo)*
- Server unit tests (Vitest + Supertest) for create/refund/dispute handlers with Stripe SDK mocked.
- Webhook handler test ensuring signature validation + status transitions. *(todo)*

### 7. Monitoring & SOC2 Evidence *(in progress — requires public API URL)*
- **Webhook uptime:** Configure Stripe webhook alerting (dashboard > Developers > Webhooks > Failure alerts) and external monitor hitting `/api/health` every 1 min. *(Deferred until staging domain exists.)*
- **Log aggregation:** Ship `stripeWebhookHandler` errors to central logging (Datadog/Splunk) with alert on `Webhook Error` or `StripeAuthenticationError` signatures.
- **Daily reconciliation:** Schedule job comparing Stripe payouts vs. `Payment` collection; export signed CSV for finance review.
- **Evidence artifacts:** Retain QA checklist runs, webhook alert configuration screenshots, payout reconciliation reports, and test logs for SOC2 control CM-6 / SI-4.
- **Secrets management:** Document storage/rotation of Stripe keys in secret manager; rotate quarterly and log approvals.

### Development vs Production

**Development**:
- Use sandbox payment processor
- Mock payment responses when Stripe keys absent
- Enable debug logging
- Use test payment methods

**Production**:
- Live payment processor integration
- Real payment method validation
- Audit logging enabled
- Enhanced security measures

## Deployment Checklist

### Pre-Deployment

- [ ] Convert all auth components to `.jsx`
- [ ] Update import statements in `App.tsx`
- [x] Implement backend API endpoints
- [x] Configure payment processor integration
- [x] Set up environment variables
- [x] Create database tables for payment data
- [ ] Implement security measures (PCI compliance) *(webhook monitoring, audit logging & SOPs pending)*
- [x] Implement automated test suite baseline (Vitest/RTL + Supertest smoke tests)
- [x] Publish manual QA script (`docs/payments-qa-checklist.md`)
- [x] Document refund/dispute SOP and share with operations (`docs/payments-operations-sop.md`)
- [ ] Configure webhook monitoring & alerting (Stripe dashboard + external uptime check)
- [ ] Archive SOC2 evidence bundle (QA runs, monitoring screenshots, reconciliation report)

### Post-Deployment Verification

- [ ] Test payment processing end-to-end
- [ ] Verify refund functionality
- [ ] Test dispute management workflow
- [ ] Validate export functionality
- [ ] Confirm responsive design
- [ ] Check accessibility compliance
- [ ] Verify security audit logging

### Performance Considerations

**Optimization Targets**:
- Payment form rendering < 200ms
- Transaction history loading < 500ms
- Export generation < 2s for 1000+ records
- Real-time status updates < 100ms

**Monitoring Requirements**:
- Payment success/failure rates
- Transaction processing times
- API response times
- Error rates and types

## Documentation Updates

### User Documentation

- Payment processing guide
- Refund procedures
- Dispute resolution process
- Administrative settings guide

### Developer Documentation

- API integration guide
- Component usage examples
- Security implementation guide
- Testing procedures

## Migration Strategy

### Phase 1: Core Payment Processing
- Deploy payment form and confirmation
- Enable basic transaction history
- Implement payment method management

### Phase 2: Advanced Features
- Add refund processing
- Enable dispute management
- Implement advanced reporting

### Phase 3: Administrative Features
- Full payment settings configuration
- Advanced export capabilities
- Comprehensive audit trails

## Risk Mitigation

### Security Risks

**Risk**: Payment data exposure
**Mitigation**: Implement proper tokenization and encryption

**Risk**: Unauthorized access
**Mitigation**: Strong authentication and authorization checks

### Technical Risks

**Risk**: Payment processor downtime
**Mitigation**: Implement fallback payment methods

**Risk**: Data inconsistency
**Mitigation**: Transaction rollback mechanisms

## Support and Maintenance

### Ongoing Requirements

- Regular security audits
- Payment processor updates
- Compliance monitoring
- Performance optimization
- User feedback integration

### Monitoring and Alerts

- Failed payment notifications
- Unusual transaction patterns
- API rate limit warnings
- Security breach alerts

---

**Next Steps**: Begin with file extension conversion and user context integration verification, then proceed with backend API implementation following the outlined specifications.
