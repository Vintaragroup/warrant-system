import { Queue } from 'bullmq';
import mongoose from 'mongoose';
import { config, getIngestionTimestamp, isWithinWindow, logger } from '@inmate/shared';
import { shouldAutoEnrich } from './rules';
import { EnrichmentJobModel } from '@inmate/shared';

export async function setupChangeStreamWatcher(queue: Queue) {
  const db = mongoose.connection;
  const collection = db.collection(config.subjectsCollection);
  const changeStream = collection.watch([{ $match: { operationType: 'insert' } }], { fullDocument: 'updateLookup' });
  changeStream.on('change', async (change: any) => {
    const doc = (change as any).fullDocument as any;
    const subjectId = doc?.spn || doc?.subject_id || doc?.subjectId;
    if (!subjectId) return;
  const ts = getIngestionTimestamp(doc);
  if (!ts || !isWithinWindow(ts, config.enrichmentWindowHours)) return;
  const bondAmount = (doc as any)?.bond_amount || (doc as any)?.bond || 0;
  if (typeof bondAmount === 'number' && bondAmount < config.bondThreshold) return;
    const { ok } = shouldAutoEnrich(doc);
    if (!ok) return;
    // idempotency
    const since = new Date(Date.now() - config.idempotencyWindowSeconds * 1000);
    const existing = await EnrichmentJobModel.findOne({ subjectId, status: 'SUCCEEDED', updatedAt: { $gte: since } });
    if (existing) return;
    const active = await EnrichmentJobModel.findOne({ subjectId, status: { $in: ['NEW', 'READY', 'RUNNING'] } });
    if (active) return;
    const job = await queue.add('enrich', { subjectId, mode: 'standard' }, { removeOnComplete: true, removeOnFail: false, jobId: `${subjectId}:standard` });
    await EnrichmentJobModel.create({ jobId: job.id, subjectId, status: 'READY', steps: [], progress: 0, logs: [], errors: [], idempotencyKey: `${subjectId}:v1` });
    logger.info('Auto-enqueued enrichment', { subjectId, jobId: job.id });
  });
  changeStream.on('error', (err: any) => {
    logger.error('Change stream error', { err: String(err) });
  });
}
