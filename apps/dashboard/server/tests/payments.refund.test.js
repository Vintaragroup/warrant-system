import { describe, it, expect, beforeEach, vi } from 'vitest';

let stripeMocks;

vi.mock('../src/lib/stripe.js', () => {
  stripeMocks = {
    paymentIntents: {
      retrieve: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
    },
  };
  return {
    getStripe: () => stripeMocks,
  };
});

vi.mock('../src/routes/utils/authz.js', () => ({
  assertPermission: () => {},
}));

let paymentFindOneMock;

vi.mock('../src/models/Payment.js', () => {
  paymentFindOneMock = vi.fn();
  return {
    default: {
      findOne: (...args) => paymentFindOneMock(...args),
    },
  };
});

const { refundPaymentHandler, resolveDisputeHandler } = await import('../src/routes/payments.js');

function buildRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

function buildPayment(overrides = {}) {
  return {
    transactionId: 'TXN-2025-ABC123',
    amount: 42,
    currency: 'usd',
    status: 'completed',
    stripePaymentIntentId: 'pi_test_123',
    stripeChargeId: 'ch_test_123',
    metadata: new Map(),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  stripeMocks.paymentIntents.retrieve.mockReset();
  stripeMocks.refunds.create.mockReset();
  paymentFindOneMock.mockReset();
});

describe('refundPaymentHandler', () => {
  it('creates a Stripe refund and updates payment record', async () => {
    const paymentDoc = buildPayment();
    paymentFindOneMock.mockResolvedValue(paymentDoc);
    stripeMocks.refunds.create.mockResolvedValue({
      id: 're_test_123',
      amount: 3000,
      currency: 'usd',
      status: 'succeeded',
      created: 1_700_000_000,
    });

    const req = {
      params: { id: paymentDoc.transactionId },
      body: { amount: 30, reason: 'Customer request' },
      user: { uid: 'tester' },
    };
    const res = buildRes();

    await refundPaymentHandler(req, res);

    expect(stripeMocks.refunds.create).toHaveBeenCalledWith({
      charge: 'ch_test_123',
      amount: 3000,
      reason: 'Customer request',
    });
    expect(paymentDoc.status).toBe('refunded');
    expect(paymentDoc.metadata.get('lastRefundId')).toBe('re_test_123');
    expect(paymentDoc.metadata.get('refundReason')).toBe('Customer request');
    expect(paymentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      refund: {
        id: 're_test_123',
        transactionId: paymentDoc.transactionId,
        amount: 30,
        currency: 'usd',
        status: 'succeeded',
        requestedAt: 1_700_000_000_000,
      },
    });
  });

  it('returns 404 when payment missing', async () => {
    paymentFindOneMock.mockResolvedValue(null);
    const res = buildRes();

    await refundPaymentHandler({ params: { id: 'missing' }, body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Payment not found' });
    expect(stripeMocks.refunds.create).not.toHaveBeenCalled();
  });
});

describe('resolveDisputeHandler', () => {
  it('marks dispute resolved and returns updated record', async () => {
    const paymentDoc = buildPayment({
      status: 'disputed',
      disputedAt: null,
    });
    paymentFindOneMock.mockResolvedValue(paymentDoc);

    const req = {
      params: { id: paymentDoc.transactionId },
      body: { notes: 'Evidence uploaded' },
    };
    const res = buildRes();

    await resolveDisputeHandler(req, res);

    expect(paymentDoc.status).toBe('completed');
    expect(paymentDoc.disputedAt).toBeInstanceOf(Date);
    expect(paymentDoc.metadata.get('disputeNotes')).toBe('Evidence uploaded');
    expect(paymentDoc.save).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      dispute: {
        id: paymentDoc.transactionId,
        transactionId: paymentDoc.transactionId,
        status: 'resolved',
        resolvedAt: paymentDoc.disputedAt,
        notes: 'Evidence uploaded',
      },
    });
  });
});
