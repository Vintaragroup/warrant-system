import nacl from 'tweetnacl';

export function getTelnyxCredentials() {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    throw new Error('Telnyx credentials missing (set TELNYX_API_KEY)');
  }
  return { apiKey };
}

export function getTelnyxSenderConfig() {
  const from = process.env.TELNYX_MESSAGING_FROM_NUMBER;
  const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID;
  if (!from && !messagingProfileId) {
    throw new Error(
      'TELNYX_MESSAGING_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID is required to send SMS'
    );
  }
  return { from, messagingProfileId };
}

export function getStatusCallbackUrl() {
  if (process.env.TELNYX_STATUS_CALLBACK_URL) {
    return process.env.TELNYX_STATUS_CALLBACK_URL;
  }
  const apiOrigin = process.env.API_ORIGIN || process.env.WEB_ORIGIN || 'http://localhost:8080';
  return `${apiOrigin.replace(/\/$/, '')}/api/messages/telnyx/status`;
}

export async function sendTelnyxMessage({ to, body }) {
  const { apiKey } = getTelnyxCredentials();
  const { from, messagingProfileId } = getTelnyxSenderConfig();

  const payload = { to, text: body };
  if (from) {
    payload.from = from;
    if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
  } else if (messagingProfileId) {
    payload.messaging_profile_id = messagingProfileId;
  }

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error(
      `Telnyx API error (${res.status}): ${json?.errors?.[0]?.detail || res.statusText}`
    );
    err.code = json?.errors?.[0]?.code;
    err.statusCode = res.status;
    err.telnyxResponse = json;
    throw err;
  }

  return json?.data;
}

/**
 * Verifies Telnyx's ed25519 webhook signature.
 * Headers: telnyx-signature-ed25519, telnyx-timestamp.
 * Signed payload delimiter (`|`) is per Telnyx's current webhook-signing docs —
 * reconfirm against a real captured webhook before relying on this in production.
 */
export function verifyTelnyxWebhookSignature({ signature, timestamp, rawBody }) {
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKeyB64) {
    console.warn('Telnyx webhook validation skipped: no public key configured');
    return true;
  }
  if (!signature || !timestamp || rawBody == null) {
    return false;
  }
  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
    return false;
  }
  try {
    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const signedPayload = Buffer.from(`${timestamp}|${bodyString}`, 'utf8');
    const signatureBytes = Buffer.from(signature, 'base64');
    const publicKeyBytes = Buffer.from(publicKeyB64, 'base64');
    return nacl.sign.detached.verify(signedPayload, signatureBytes, publicKeyBytes);
  } catch (err) {
    console.warn('Telnyx signature verification error', err?.message || err);
    return false;
  }
}
