import { ensureMessagingWorker } from './messaging.js';
import { ensureGpsWorker } from './checkins.js';
import { processOutboundMessageJob } from '../services/messaging.js';

export function initQueues() {
  if (process.env.DISABLE_QUEUE_WORKERS === 'true') {
    console.warn('⚠️  Queue workers disabled via DISABLE_QUEUE_WORKERS flag');
    return;
  }

  if (!process.env.REDIS_URL) {
    console.warn('⚠️  REDIS_URL not set — skipping queue workers initialization');
    return;
  }

  try {
    ensureMessagingWorker(processOutboundMessageJob);
  } catch (err) {
    console.error('Failed to start messaging worker:', err?.message || err);
  }

  try {
    ensureGpsWorker();
  } catch (err) {
    console.error('Failed to start GPS worker:', err?.message || err);
  }
}

export { getMessagingQueue } from './messaging.js';
export { getGpsQueue } from './checkins.js';
