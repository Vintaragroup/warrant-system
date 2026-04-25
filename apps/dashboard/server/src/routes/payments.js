import express from 'express';
import { nanoid } from 'nanoid';
import Payment from '../models/Payment.js';
import { assertPermission } from './utils/authz.js';
import { getStripe, verifyStripeSignature } from '../lib/stripe.js';

const router = express.Router();

const PAYMENT_TYPE_LABELS = {
  bond: 'Bond Payment',
  partial: 'Partial Payment',
  fee: 'Service Fee',
  premium: 'Premium Payment',
};

const PLACEHOLDER_METHODS = [
  {
    id: 'pm_card_visa',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2026,
    label: 'Business Account',
    isDefault: true,
    status: 'active',
  },
  {
    id: 'pm_bank_1',
    type: 'bank_account',
    bankName: 'First National Bank',
    last4: '7890',
    accountType: 'checking',
    label: 'Primary Business Account',
    isDefault: false,
    status: 'active',
  },
];

function serializePayment(doc) {
  if (!doc) return null;
  const data = typeof doc.toObject === 'function'
    ? doc.toObject({ versionKey: false })
    : { ...doc };
  if (data._id) {
    data.id = data._id.toString();
    delete data._id;
  }
  return data;
}

function ensureMetadataMap(doc) {
  if (!doc) return;
  if (!doc.metadata || typeof doc.metadata.set !== 'function') {
    const existing = doc.metadata && typeof doc.metadata === 'object'
      ? doc.metadata
      : {};
    doc.metadata = new Map(Object.entries(existing));
  }
}

function parseListQuery(query = {}) {
  const filters = {};
  if (query.status && query.status !== 'all') {
    filters.status = String(query.status);
  }
  if (query.method && query.method !== 'all') {
    filters.method = String(query.method);
  }
  if (query.search) {
    const regex = new RegExp(String(query.search), 'i');
    filters.$or = [
      { transactionId: regex },
      { clientName: regex },
      { bondNumber: regex },
    ];
  }
  return filters;
}

function computeMetrics(payments = []) {
  const completed = payments.filter((payment) => payment.status === 'completed');
  const failed = payments.filter((payment) => payment.status === 'failed');
  const processing = payments.filter((payment) => payment.status === 'processing' || payment.status === 'pending');
  const totalRevenue = completed.reduce((sum, payment) => sum + payment.amount, 0);
  const successRate = completed.length + failed.length === 0
    ? 1
    : completed.length / (completed.length + failed.length);

  return {
    summary: {
      totalRevenue: {
        value: totalRevenue,
        currency: payments[0]?.currency || 'usd',
        changeRatio: 0,
        label: 'This month',
      },
      activeBonds: {
        value: completed.length,
        change: 0,
        label: 'Completed payments',
      },
      successRate: {
        value: successRate,
        change: 0,
        label: 'Last 30 days',
      },
      pendingPayments: {
        value: processing.length,
        change: 0,
        label: 'Awaiting processing',
      },
    },
    methodBreakdown: [],
    revenueTrend: [],
    alerts: [],
    upcomingPayouts: [],
  };
}

function dollarsToCents(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value * 100);
}

async function attachChargeDetails(paymentDoc, charge) {
  if (!paymentDoc || !charge) return;
  paymentDoc.stripeChargeId = charge.id;
  if (charge.balance_transaction && typeof charge.balance_transaction === 'string') {
    try {
      const stripeClient = getStripe();
      const balance = await stripeClient.balanceTransactions.retrieve(charge.balance_transaction);
      paymentDoc.fees = typeof balance.fee === 'number' ? balance.fee / 100 : paymentDoc.fees;
      paymentDoc.netAmount = typeof balance.net === 'number' ? balance.net / 100 : paymentDoc.netAmount;
    } catch (err) {
      console.warn('⚠️  Failed to retrieve balance transaction', err.message);
    }
  } else if (charge.balance_transaction && typeof charge.balance_transaction === 'object') {
    paymentDoc.fees = typeof charge.balance_transaction.fee === 'number' ? charge.balance_transaction.fee / 100 : paymentDoc.fees;
    paymentDoc.netAmount = typeof charge.balance_transaction.net === 'number' ? charge.balance_transaction.net / 100 : paymentDoc.netAmount;
  }
}

router.get('/', async (req, res) => {
  assertPermission(req, 'billing:read');
  const filters = parseListQuery(req.query);
  const payments = await Payment.find(filters).sort({ createdAt: -1 }).limit(200).lean();
  res.json({
    items: payments.map((payment) => serializePayment(payment)),
    total: payments.length,
  });
});

router.get('/metrics', async (req, res) => {
  assertPermission(req, 'billing:read');
  const payments = await Payment.find({}).sort({ createdAt: -1 }).lean();
  res.json(computeMetrics(payments));
});

router.get('/methods', (req, res) => {
  assertPermission(req, 'billing:read');
  res.json({ methods: PLACEHOLDER_METHODS });
});

router.post('/methods', (req, res) => {
  assertPermission(req, 'billing:manage');
  res.status(501).json({ error: 'Managing payment methods is handled directly via Stripe dashboard.' });
});

router.get('/settings', (req, res) => {
  assertPermission(req, 'billing:read');
  res.json({
    settings: {
      defaultMethodId: PLACEHOLDER_METHODS[0]?.id || null,
      acceptedMethods: ['card', 'ach_debit', 'wire', 'check'],
      autoCapture: true,
      autoCaptureDelayMinutes: 15,
      receiptEmailEnabled: true,
      approvalThreshold: 5000,
      twoPersonApproval: true,
      notifyOnLargePayment: true,
      notifyRecipients: ['billing@example.com'],
      automationRules: [],
    },
  });
});

router.put('/settings', (req, res) => {
  assertPermission(req, 'billing:manage');
  res.status(200).json({ settings: req.body || {} });
});

export async function createPaymentHandler(req, res) {
  assertPermission(req, 'billing:manage');
  const payload = req.body || {};
  const cents = dollarsToCents(payload.amount);
  if (!cents) {
    return res.status(400).json({ error: 'amount is required and must be greater than zero' });
  }
  const currency = (payload.currency || 'usd').toLowerCase();
  const method = payload.method || 'card';
  const transactionId = `TXN-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  const stripe = getStripe();

  const paymentIntent = await stripe.paymentIntents.create({
    amount: cents,
    currency,
    description: payload.description || `${PAYMENT_TYPE_LABELS?.[payload.paymentType] || 'Payment'} ${transactionId}`,
    metadata: {
      transactionId,
      bondNumber: payload.bondNumber || '',
      paymentType: payload.paymentType || 'bond',
    },
    automatic_payment_methods: { enabled: true },
    receipt_email: payload.clientEmail || undefined,
  });

  const paymentDoc = await Payment.create({
    transactionId,
    amount: Number(payload.amount),
    currency,
    fees: 0,
    netAmount: 0,
    method,
    status: 'processing',
    description: payload.description || '',
    bondNumber: payload.metadata?.caseNumber || payload.bondNumber || '',
    clientName: payload.clientName || '',
    clientEmail: payload.clientEmail || '',
    metadata: payload.metadata || {},
    stripePaymentIntentId: paymentIntent.id,
    createdByUid: req.user?.uid || '',
  });

  res.status(202).json({
    payment: serializePayment(paymentDoc),
    clientSecret: paymentIntent.client_secret,
  });
}

router.post('/', createPaymentHandler);

router.get('/:id', async (req, res) => {
  assertPermission(req, 'billing:read');
  const payment = await Payment.findOne({ transactionId: req.params.id }).lean();
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }
  res.json({ payment: serializePayment(payment) });
});

export async function refundPaymentHandler(req, res) {
  assertPermission(req, 'billing:manage');
  const payment = await Payment.findOne({ transactionId: req.params.id });
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }
  if (!payment.stripePaymentIntentId) {
    return res.status(400).json({ error: 'Payment is not associated with Stripe payment intent' });
  }
  const amount = dollarsToCents(req.body?.amount ?? payment.amount);
  if (!amount) {
    return res.status(400).json({ error: 'Refund amount is required' });
  }

  const stripe = getStripe();
  let chargeId = payment.stripeChargeId;
  if (!chargeId) {
    const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, {
      expand: ['latest_charge'],
    });
    chargeId = intent?.latest_charge?.id || intent?.charges?.data?.[0]?.id;
  }
  if (!chargeId) {
    return res.status(400).json({ error: 'Unable to locate Stripe charge for refund' });
  }

  const refund = await stripe.refunds.create({
    charge: chargeId,
    amount,
    reason: req.body?.reason || undefined,
  });

  payment.status = 'refunded';
  payment.refundedAt = new Date();
  ensureMetadataMap(payment);
  payment.metadata.set('lastRefundId', refund.id);
  if (req.body?.reason) {
    payment.metadata.set('refundReason', req.body.reason);
  }
  await payment.save();

  res.status(202).json({
    refund: {
      id: refund.id,
      transactionId: payment.transactionId,
      amount: refund.amount / 100,
      currency: refund.currency,
      status: refund.status,
      requestedAt: refund.created * 1000,
    },
  });
}

router.post('/:id/refund', refundPaymentHandler);

router.get('/refunds/eligible', async (req, res) => {
  assertPermission(req, 'billing:read');
  const payments = await Payment.find({ status: { $in: ['completed', 'processing'] } }).sort({ createdAt: -1 }).limit(50).lean();
  const items = payments.map((payment) => {
    const created = payment.createdAt ? new Date(payment.createdAt) : new Date();
    const daysAgo = Math.max(0, Math.round((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)));
    return {
      id: payment.transactionId,
      caseNumber: payment.bondNumber || '—',
      client: payment.clientName || '—',
      originalAmount: payment.amount,
      refundableAmount: Math.max(0, payment.amount - (payment.fees || 0)),
      status: payment.status === 'completed' ? 'eligible' : 'processing',
      daysAgo,
    };
  });
  res.json({ items });
});

router.get('/refunds/requests', async (req, res) => {
  assertPermission(req, 'billing:read');
  const payments = await Payment.find({ status: 'refunded' }).sort({ refundedAt: -1 }).limit(50).lean();
  const items = payments.map((payment) => ({
    id: payment.metadata?.get?.('lastRefundId') || `refund-${payment.transactionId}`,
    transactionId: payment.transactionId,
    client: payment.clientName || '—',
    requestedAt: payment.refundedAt || payment.updatedAt || payment.createdAt,
    amount: payment.amount,
    status: 'completed',
    reason: payment.metadata?.get?.('refundReason') || '',
    requestedBy: payment.createdByUid || undefined,
  }));
  res.json({ items });
});

router.get('/disputes', async (req, res) => {
  assertPermission(req, 'billing:read');
  const disputes = await Payment.find({ status: 'disputed' }).sort({ disputedAt: -1 }).limit(50).lean();
  const items = disputes.map((payment) => ({
    id: payment.transactionId,
    transactionId: payment.transactionId,
    amount: payment.amount,
    openedAt: payment.disputedAt || payment.updatedAt || payment.createdAt,
    client: payment.clientName || '—',
    reason: payment.metadata?.get?.('disputeReason') || 'Dispute reported',
    status: 'needs_response',
    responseDeadline: null,
    notes: payment.metadata?.get?.('disputeNotes') || null,
  }));
  res.json({ items });
});

export async function resolveDisputeHandler(req, res) {
  assertPermission(req, 'billing:manage');
  const payment = await Payment.findOne({ transactionId: req.params.id });
  if (!payment) {
    return res.status(404).json({ error: 'Dispute not found' });
  }
  payment.status = 'completed';
  payment.disputedAt = new Date();
  ensureMetadataMap(payment);
  payment.metadata.set('disputeNotes', req.body?.notes || '');
  await payment.save();
  res.json({ dispute: {
    id: payment.transactionId,
    transactionId: payment.transactionId,
    status: 'resolved',
    resolvedAt: payment.disputedAt,
    notes: payment.metadata.get('disputeNotes') || '',
  } });
}

router.post('/disputes/:id/resolve', resolveDisputeHandler);

export async function stripeWebhookHandler(req, res) {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return res.status(400).send('Missing Stripe webhook signature or secret');
  }

  let event;
  try {
    event = verifyStripeSignature(req.body, signature, webhookSecret);
  } catch (err) {
    console.error('⚠️  Stripe webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    getStripe();
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
        if (payment) {
          payment.status = 'completed';
          payment.processedAt = new Date();
          payment.netAmount = typeof pi.amount_received === 'number' ? pi.amount_received / 100 : payment.netAmount;
          if (pi.charges?.data?.length) {
            const charge = pi.charges.data[0];
            await attachChargeDetails(payment, charge);
          }
          ensureMetadataMap(payment);
          await payment.save();
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
        if (payment) {
          payment.status = 'failed';
          ensureMetadataMap(payment);
          payment.metadata.set('failureReason', pi.last_payment_error?.message || 'Payment failed');
          await payment.save();
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object;
        const payment = await Payment.findOne({ stripeChargeId: charge.id })
          || await Payment.findOne({ stripePaymentIntentId: charge.payment_intent });
        if (payment) {
          payment.status = 'refunded';
          payment.refundedAt = new Date();
          ensureMetadataMap(payment);
          payment.metadata.set('lastRefundId', charge.refunds?.data?.[0]?.id || charge.id);
          await payment.save();
        }
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const payment = await Payment.findOne({ stripeChargeId: dispute.charge });
        if (payment) {
          payment.status = 'disputed';
          payment.disputedAt = new Date();
          ensureMetadataMap(payment);
          payment.metadata.set('disputeReason', dispute.reason || 'dispute');
          await payment.save();
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('⚠️  Error handling Stripe webhook:', err);
    return res.status(500).send('Error processing webhook');
  }

  res.json({ received: true });
}

export default router;
