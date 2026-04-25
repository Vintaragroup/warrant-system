import { Queue, Worker } from 'bullmq';
import { createNewRedisConnection } from '../lib/redis.js';

const queues = new Map();
const workers = new Map();

function ensureRedisConfigured() {
  if (!process.env.REDIS_URL) {
    console.warn('⚠️  REDIS_URL not set — queue operations will be no-ops');
    return false;
  }
  return true;
}

export function getQueue(name) {
  if (!ensureRedisConfigured()) {
    return null;
  }
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: createNewRedisConnection() }));
  }
  return queues.get(name);
}

export function ensureWorker(name, processor, options = {}) {
  if (!ensureRedisConfigured()) {
    return null;
  }
  if (workers.has(name)) {
    return workers.get(name);
  }
  const worker = new Worker(name, processor, {
    connection: createNewRedisConnection(),
    concurrency: options.concurrency || 5,
    autorun: options.autorun !== false,
  });

  worker.on('completed', (job) => {
    if (options.logSuccess !== false) {
      console.log(`✅ job ${job.id} completed on ${name}`);
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ job ${job?.id} failed on ${name}:`, err?.message || err);
  });

  workers.set(name, worker);
  return worker;
}

export function getQueues() {
  return queues;
}

export function getWorkers() {
  return workers;
}
