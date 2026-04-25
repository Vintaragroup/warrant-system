import { ensureWorker, getQueue } from './queueFactory.js';

const QUEUE_NAME = 'messaging_send';

export function getMessagingQueue() {
  return getQueue(QUEUE_NAME);
}

export function ensureMessagingWorker(processor, options = {}) {
  const concurrency = Number(process.env.MESSAGING_QUEUE_CONCURRENCY || options.concurrency || 5);
  return ensureWorker(QUEUE_NAME, async (job) => processor(job?.data || {}), { concurrency });
}
