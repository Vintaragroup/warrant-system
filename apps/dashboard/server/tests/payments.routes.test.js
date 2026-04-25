import { describe, it, expect, beforeEach, vi } from 'vitest';

let stripeCreateMock;

vi.mock('../src/lib/stripe.js', () => {
  stripeCreateMock = vi.fn();
  return {
    getStripe: () => ({
      paymentIntents: {
        create: stripeCreateMock,
      },
    }),
  };
});

vi.mock('../src/routes/utils/authz.js', () => ({
  assertPermission: () => {},
}));

let paymentCreateMock;
let paymentFindMock;
let paymentFindOneMock;

vi.mock('../src/models/Payment.js', () => {
  paymentCreateMock = vi.fn();
  paymentFindMock = vi.fn(() => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) }));
  paymentFindOneMock = vi.fn();

  return {
    default: {
      create: (...args) => paymentCreateMock(...args),
      find: (...args) => paymentFindMock(...args),
      findOne: (...args) => paymentFindOneMock(...args),
    },
  };
});

const { createPaymentHandler } = await import('../src/routes/payments.js');

function buildRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(() => {
  stripeCreateMock.mockReset();
  paymentCreateMock.mockReset();
  paymentFindMock.mockReset();
  paymentFindOneMock.mockReset();

  stripeCreateMock.mockResolvedValue({
    id: 'pi_test_123',
    client_secret: 'secret_123',
  });

  paymentCreateMock.mockImplementation(async (record) => ({
    ...record,
    _id: '507f1f77bcf86cd799439011',
    metadata: record.metadata || {},
    toObject() {
      return {
        ...record,
        id: '507f1f77bcf86cd799439011',
      };
    },
  }));
});

describe('createPaymentHandler', () => {
  it('creates a Stripe PaymentIntent and returns client secret', async () => {
    const req = {
      body: {
        amount: 42,
        currency: 'usd',
        clientName: 'QA Tester',
        clientEmail: 'qa@example.com',
        paymentType: 'bond',
        metadata: { caseNumber: 'BB-2024-01' },
      },
      user: { uid: 'tester' },
    };
    const res = buildRes();

    await createPaymentHandler(req, res);

    expect(stripeCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4200, currency: 'usd', receipt_email: 'qa@example.com' })
    );
    expect(paymentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 42, clientName: 'QA Tester' })
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSecret: 'secret_123',
        payment: expect.objectContaining({ transactionId: expect.stringMatching(/^TXN-/) }),
      })
    );
  });

  it('rejects requests without a valid amount', async () => {
    const req = {
      body: { amount: 0, clientName: 'QA', clientEmail: 'qa@example.com' },
      user: { uid: 'tester' },
    };
    const res = buildRes();

    await createPaymentHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'amount is required and must be greater than zero' });
    expect(stripeCreateMock).not.toHaveBeenCalled();
    expect(paymentCreateMock).not.toHaveBeenCalled();
  });
});
