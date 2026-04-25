import twilio from 'twilio';

let client = null;

export function getTwilioCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials missing (set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN)');
  }
  return { accountSid, authToken };
}

export function getTwilioClient() {
  if (!client) {
    const { accountSid, authToken } = getTwilioCredentials();
    client = twilio(accountSid, authToken, { lazyLoading: true });
  }
  return client;
}

export function getMessagingServiceSid() {
  const sid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid) {
    throw new Error('TWILIO_MESSAGING_SERVICE_SID is required to send SMS');
  }
  return sid;
}

export function getStatusCallbackUrl() {
  if (process.env.TWILIO_STATUS_CALLBACK_URL) {
    return process.env.TWILIO_STATUS_CALLBACK_URL;
  }
  const apiOrigin = process.env.API_ORIGIN || process.env.WEB_ORIGIN || 'http://localhost:8080';
  return `${apiOrigin.replace(/\/$/, '')}/api/messages/twilio/status`;
}

export function validateTwilioSignature({ url, signature, params }) {
  const token = process.env.TWILIO_WEBHOOK_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    console.warn('Twilio webhook validation skipped: no auth token configured');
    return true;
  }
  if (!signature) {
    return false;
  }
  return twilio.validateRequest(token, signature, url, params);
}
