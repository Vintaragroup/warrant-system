import nodemailer from 'nodemailer';

function resolveBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const s = String(value).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function createTransportFromEnv() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = resolveBoolean(process.env.SMTP_SECURE, port === 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    console.warn('SMTP_HOST not set; skipping email send');
    return null;
  }

  const transportOptions = { host, port, secure };
  // Allow auth-less SMTP (e.g., MailHog). Only add auth if both user and pass are provided.
  if (user && pass) {
    transportOptions.auth = { user, pass };
  }
  const transporter = nodemailer.createTransport(transportOptions);
  return transporter;
}

export async function sendInviteEmail({ to, inviteLink, displayName }) {
  const transporter = createTransportFromEnv();
  if (!transporter) return false;
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || `no-reply@${(process.env.WEB_ORIGIN || '').replace(/^https?:\/\//, '')}`;
  const appName = process.env.APP_NAME || 'Bail Bonds Dashboard';
  const subject = `${appName} – You’re invited`;
  const html = `
    <p>Hello${displayName ? ` ${displayName}` : ''},</p>
    <p>You have been invited to ${appName}. Click the link below to set your password and sign in:</p>
    <p><a href="${inviteLink}">Set your password and sign in</a></p>
    <p>If you didn’t expect this invite, you can ignore this message.</p>
  `;
  const text = `Hello${displayName ? ` ${displayName}` : ''},\n\n` +
    `You have been invited to ${appName}. Use the link below to set your password and sign in:\n` +
    `${inviteLink}\n\n` +
    `If you didn’t expect this invite, you can ignore this message.`;
  try {
    await transporter.sendMail({ from, to, subject, text, html });
    return true;
  } catch (err) {
    console.warn('Failed to send invite email:', err?.message);
    return false;
  }
}
