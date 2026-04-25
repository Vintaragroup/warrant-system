import { ensureWorker, getQueue } from './queueFactory.js';

const GPS_QUEUE = 'checkins_gps';
let lastGpsJobAt = null;
let lastGpsJobMeta = null;

export function getGpsQueue() {
  return getQueue(GPS_QUEUE);
}

export function getLastGpsJobHeartbeat() {
  return {
    lastJobAt: lastGpsJobAt,
    lastJobMeta: lastGpsJobMeta,
  };
}

export function ensureGpsWorker() {
  const concurrency = Number(process.env.CHECKINS_QUEUE_CONCURRENCY || 2);
  return ensureWorker(
    GPS_QUEUE,
    async (job) => {
      lastGpsJobAt = new Date().toISOString();
      lastGpsJobMeta = {
        id: job?.id ?? null,
        name: job?.name ?? null,
        scheduledFor: job?.data?.scheduledFor ?? null,
        reason: job?.data?.reason ?? null,
      };
      console.log(`ℹ️  GPS queue received job ${job.id}`, job.name, job.data);
      // Placeholder: real implementation will dispatch notifications and wait for provider callback.
    },
    { concurrency, logSuccess: false },
  );
}
