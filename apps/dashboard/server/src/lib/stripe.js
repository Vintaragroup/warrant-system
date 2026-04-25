import Stripe from 'stripe';

const STRIPE_API_VERSION = '2024-06-20';
let stripeSingleton = null;

export function getStripe() {
  if (stripeSingleton) return stripeSingleton;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error('STRIPE_SECRET_KEY is not configured. Set it in your environment to enable payments.');
  }
  stripeSingleton = new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
  });
  return stripeSingleton;
}

export function verifyStripeSignature(payload, signature, webhookSecret) {
  const stripe = getStripe();
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
