import { Router } from 'express';
import { z } from 'zod';
import { assertPermission as ensurePermission } from './utils/authz.js';
import { enqueueOutboundMessage, listMessages, applyTelnyxStatusUpdate, recordInboundMessage } from '../services/messaging.js';
import { verifyTelnyxWebhookSignature } from '../lib/messaging/telnyx.js';

const router = Router();
export const telnyxWebhooks = Router();

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



function verifyTelnyx(req, res) {
  const signature = req.headers['telnyx-signature-ed25519'];
  const timestamp = req.headers['telnyx-timestamp'];
  const rawBody = req.rawBody;
  const valid = verifyTelnyxWebhookSignature({ signature, timestamp, rawBody });
  if (!valid) {
    console.warn('Telnyx webhook signature invalid');
    res.status(403).send('Invalid signature');
    return false;
  }
  return true;
}

telnyxWebhooks.post('/status', async (req, res) => {
  if (!verifyTelnyx(req, res)) return;
  try {
    const eventType = req.body?.data?.event_type;
    const payload = req.body?.data?.payload;
    await applyTelnyxStatusUpdate({ eventType, payload });
    res.status(200).send('ok');
  } catch (err) {
    console.error('Telnyx status webhook error', err?.message || err);
    res.status(500).send('error');
  }
});

// Telnyx can be configured to fan multiple event types (sent/finalized/received)
// into one webhook URL depending on the Messaging Profile setup — ignore
// anything that isn't an inbound message here.
telnyxWebhooks.post('/inbound', async (req, res) => {
  if (!verifyTelnyx(req, res)) return;
  try {
    const eventType = req.body?.data?.event_type;
    if (eventType !== 'message.received') {
      return res.status(200).send('ignored');
    }
    const payload = req.body?.data?.payload;
    await recordInboundMessage({
      from: payload?.from?.phone_number,
      to: Array.isArray(payload?.to) ? payload.to[0]?.phone_number : null,
      body: payload?.text,
      providerMessageId: payload?.id,
      raw: payload,
    });
    res.status(200).send('ok');
  } catch (err) {
    console.error('Telnyx inbound webhook error', err?.message || err);
    res.status(500).send('error');
  }
});

export default router;
