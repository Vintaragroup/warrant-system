import mongoose from 'mongoose';
import Message from '../models/Message.js';
import CaseAudit from '../models/CaseAudit.js';
import Case from '../models/Case.js';
import { getMessagingQueue } from '../jobs/messaging.js';
import { getTwilioClient, getMessagingServiceSid, getStatusCallbackUrl } from '../lib/messaging/twilio.js';

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
    provider: 'twilio',
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
    message.provider = 'twilio';
    await message.markSending();

    const client = getTwilioClient();
    const response = await client.messages.create({
      to: message.to,
      body: message.body,
      messagingServiceSid: getMessagingServiceSid(),
      statusCallback: getStatusCallbackUrl(),
    });

    message.from = response.from || message.from;

    if (response.status === 'failed' || response.status === 'undelivered') {
      await message.markFailed(response.errorCode, response.errorMessage);
    } else if (response.status === 'delivered') {
      await message.markDelivered();
      message.providerMessageId = response.sid;
      await message.save();
    } else {
      await message.markSent(response.sid);
    }
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

export async function applyTwilioStatusUpdate({ messageSid, messageStatus, to, from, errorCode, errorMessage }) {
  if (!messageSid) {
    throw new Error('Missing MessageSid');
  }
  const message = await Message.findOne({ providerMessageId: messageSid });
  if (!message) {
    console.warn(`Twilio status update for ${messageSid} ignored: message not found`);
    return null;
  }

  if (from) message.from = from;
  if (to) message.to = to;

  const status = (messageStatus || '').toLowerCase();
  switch (status) {
    case 'delivered':
      await message.markDelivered();
      break;
    case 'failed':
    case 'undelivered':
      await message.markFailed(errorCode, errorMessage);
      break;
    case 'queued':
    case 'accepted':
    case 'sending':
    case 'sent':
      await message.markSent(message.providerMessageId || messageSid);
      break;
    default:
      console.log(`Twilio status ${status} for ${messageSid} logged`);
      break;
  }

  await message.save();
  return message;
}

export async function recordInboundMessage({ from, to, body, messageSid, raw }) {
  const doc = await Message.create({
    direction: 'in',
    channel: 'sms',
    from,
    to,
    body,
    status: 'delivered',
    provider: 'twilio',
    providerMessageId: messageSid,
    meta: { raw },
  });
  return doc;
}
