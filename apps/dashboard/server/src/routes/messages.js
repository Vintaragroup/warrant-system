import { Router } from 'express';
import { z } from 'zod';
import { assertPermission as ensurePermission } from './utils/authz.js';
import { enqueueOutboundMessage, listMessages, applyTwilioStatusUpdate, recordInboundMessage } from '../services/messaging.js';
import { validateTwilioSignature } from '../lib/messaging/twilio.js';

const router = Router();
export const twilioWebhooks = Router();

const sendSchema = z.object({
  caseId: z.string().min(3),
  to: z.string().min(8),
  body: z.string().min(1).max(1600),
});

router.get('/', async (req, res) => {
  try {
    ensurePermission(req, ['cases:read', 'cases:read:department']);
    const { caseId, limit } = req.query;
    const items = await listMessages({ caseId, limit: limit ? Number(limit) : 50 });
    res.json({ items });
  } catch (err) {
    console.error('GET /messages error', err?.message || err);
    res.status(err?.statusCode || 500).json({ error: err?.message || 'Internal server error' });
  }
});

router.post('/send', async (req, res) => {
  try {
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const parsed = sendSchema.parse(req.body);
    const actor = req.user?.email || req.user?.uid || 'unknown';
    const result = await enqueueOutboundMessage({
      ...parsed,
      actor,
    });
    res.status(202).json({
      message: {
        id: result._id.toString(),
        status: result.status,
      },
    });
  } catch (err) {
    console.error('POST /messages/send error', err?.message || err);
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: err.issues });
    }
    res.status(err?.statusCode || 500).json({ error: err?.message || 'Internal server error' });
  }
});



function verifyTwilio(req, res) {
  const signature = req.headers['x-twilio-signature'];
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = req.body || {};
  const valid = validateTwilioSignature({ url, signature, params });
  if (!valid) {
    console.warn('Twilio webhook signature invalid');
    res.status(403).send('Invalid signature');
    return false;
  }
  return true;
}

twilioWebhooks.post('/status', async (req, res) => {
  if (!verifyTwilio(req, res)) return;
  try {
    const payload = {
      messageSid: req.body?.MessageSid,
      messageStatus: req.body?.MessageStatus,
      to: req.body?.To,
      from: req.body?.From,
      errorCode: req.body?.ErrorCode,
      errorMessage: req.body?.ErrorMessage,
    };
    await applyTwilioStatusUpdate(payload);
    res.status(200).send('ok');
  } catch (err) {
    console.error('Twilio status webhook error', err?.message || err);
    res.status(500).send('error');
  }
});

twilioWebhooks.post('/inbound', async (req, res) => {
  if (!verifyTwilio(req, res)) return;
  try {
    await recordInboundMessage({
      from: req.body?.From,
      to: req.body?.To,
      body: req.body?.Body,
      messageSid: req.body?.MessageSid,
      raw: req.body,
    });
    res.status(200).send('ok');
  } catch (err) {
    console.error('Twilio inbound webhook error', err?.message || err);
    res.status(500).send('error');
  }
});

export default router;
