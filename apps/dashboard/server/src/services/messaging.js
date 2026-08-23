import mongoose from 'mongoose';
import Message from '../models/Message.js';
import CaseAudit from '../models/CaseAudit.js';
import Case from '../models/Case.js';
import { getMessagingQueue } from '../jobs/messaging.js';
import { sendTelnyxMessage } from '../lib/messaging/telnyx.js';

const { ObjectId } = mongoose.Types;

function toObjectId(id) {
  if (id instanceof ObjectId) return id;
  if (!id) return null;
  if (ObjectId.isValid(id)) {
    return new ObjectId(id);
  }
  return null;
}

async function resolveCaseObjectId(caseId) {
  const direct = toObjectId(caseId);
  if (direct) return direct;
  if (!caseId) return null;
  const doc = await Case.findOne({ case_number: caseId }).select({ _id: 1 }).lean();
  return doc?._id || null;
}

export async function enqueueOutboundMessage({ caseId, to, body, actor, meta }) {
  const objectId = await resolveCaseObjectId(caseId);
  if (!objectId) {
    throw new Error('Invalid case id provided');
  }

  const message = await Message.create({
    caseId: objectId,
    direction: 'out',
    channel: 'sms',
    to,
    body,
    status: 'queued',
    provider: 'telnyx',
    meta: {
      ...(meta || {}),
      createdBy: actor || null,
    },
  });

  await CaseAudit.create({
    caseId: objectId,
    type: 'message_outbound',
    actor: actor || 'system',
    details: {
      messageId: message._id,
      to,
    },
  });

  const queue = getMessagingQueue();
  const payload = { messageId: message._id.toString() };

  if (!queue) {
    console.warn('⚠️  Messaging queue unavailable — sending inline');
    await processOutboundMessageJob(payload);
  } else {
    await queue.add('send', payload, {
      removeOnComplete: 250,
      removeOnFail: false,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1500 },
    });
  }

  return message;
}

export async function processOutboundMessageJob(data) {
  const { messageId } = data || {};
  if (!messageId) {
    console.warn('Received messaging job without messageId');
    return;
  }

  const message = await Message.findById(messageId);
  if (!message) {
    console.warn(`Messaging job ${messageId} skipped: message not found`);
    return;
  }

  if (message.isTerminal) {
    console.log(`Messaging job ${messageId} skipped: already terminal (${message.status})`);
    return;
  }

  try {
    message.provider = 'telnyx';
    await message.markSending();

    // Telnyx's send response only confirms acceptance (queued/sending) — it
    // never resolves final delivery synchronously the way Twilio sometimes
    // did. Final delivery/failure always arrives later via the status webhook
    // (applyTelnyxStatusUpdate), so we only ever mark 'sent' here.
    const response = await sendTelnyxMessage({ to: message.to, body: message.body });

    message.from = response?.from?.phone_number || message.from;
    await message.markSent(response?.id);
  } catch (err) {
    console.error(`Failed to send message ${messageId}`, err?.message || err);
    await message.markFailed(err?.code, err?.message || 'send_failed');
    throw err;
  }
}

export async function listMessages({ caseId, limit = 50 }) {
  const filter = {};
  if (caseId) {
    const id = await resolveCaseObjectId(caseId);
    if (!id) {
      throw new Error('Invalid case id');
    }
    filter.caseId = id;
  }

  return Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean();
}

export async function resendMessage({ caseId, messageId, actor }) {
  const caseObjectId = await resolveCaseObjectId(caseId);
  if (!caseObjectId) {
    throw new Error('Invalid case id');
  }
  const original = await Message.findOne({ _id: messageId, caseId: caseObjectId }).lean();
  if (!original) {
    throw new Error('Message not found');
  }
  if (original.direction !== 'out') {
    throw new Error('Only outbound messages can be resent');
  }
  if (!original.to || !original.body) {
    throw new Error('Original message missing recipient or body');
  }

  return enqueueOutboundMessage({
    caseId: caseObjectId,
    to: original.to,
    body: original.body,
    actor,
    meta: {
      ...(original.meta || {}),
      resendOf: original._id,
    },
  });
}

/**
 * Applies a Telnyx message-status webhook event to the matching Message doc.
 *
 * Field mapping is based on Telnyx's documented Message Delivery Update
 * webhook schema (payload.to[].status per-recipient, payload.errors[] on
 * failure) — confirm against one real captured webhook before treating this
 * as final, since Telnyx's schema nesting has shifted across API versions.
 */
export async function applyTelnyxStatusUpdate({ eventType, payload }) {
  const providerMessageId = payload?.id;
  if (!providerMessageId) {
    throw new Error('Missing Telnyx message id in webhook payload');
  }
  const message = await Message.findOne({ providerMessageId });
  if (!message) {
    console.warn(`Telnyx status update for ${providerMessageId} ignored: message not found`);
    return null;
  }

  if (payload?.from?.phone_number) message.from = payload.from.phone_number;
  const toNumber = Array.isArray(payload?.to) ? payload.to[0]?.phone_number : null;
  if (toNumber) message.to = toNumber;

  const recipientStatus = Array.isArray(payload?.to) ? payload.to[0]?.status : null;
  const errors = payload?.errors;
  const hasErrors = Array.isArray(errors) && errors.length > 0;

  if (hasErrors || recipientStatus === 'delivery_failed' || recipientStatus === 'sending_failed') {
    const first = errors?.[0];
    await message.markFailed(first?.code, first?.detail || first?.title);
  } else if (recipientStatus === 'delivered' || (eventType === 'message.finalized' && !hasErrors)) {
    await message.markDelivered();
  } else if (recipientStatus === 'sent' || eventType === 'message.sent') {
    await message.markSent(message.providerMessageId || providerMessageId);
  } else {
    console.log(`Telnyx event ${eventType} for ${providerMessageId} logged (status=${recipientStatus})`);
  }

  await message.save();
  return message;
}

export async function recordInboundMessage({ from, to, body, providerMessageId, raw }) {
  const doc = await Message.create({
    direction: 'in',
    channel: 'sms',
    from,
    to,
    body,
    status: 'delivered',
    provider: 'telnyx',
    providerMessageId,
    meta: { raw },
  });
  return doc;
}
