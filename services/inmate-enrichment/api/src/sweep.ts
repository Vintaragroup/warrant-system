import { Queue } from 'bullmq';
import cron from 'cron';
import { InmateModel, EnrichmentJobModel } from '@inmate/shared';
import { config, getIngestionTimestamp, isWithinWindow, logger } from '@inmate/shared';

export async function setupSweep(queue: Queue) {
  const job = new cron.CronJob(config.autoEnrichSweepCron, async () => {
    const candidates = await InmateModel.find({
      enrichment_flag: true,
      enrichment_status: { $in: ['NEW', 'READY', 'FAILED'] },
    })
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    for (const doc of candidates) {
      const subjectId = (doc as any)?.spn || (doc as any)?.subject_id || (doc as any)?.subjectId;
      if (!subjectId) continue;
      const ts = getIngestionTimestamp(doc as any);
      if (!ts || !isWithinWindow(ts, config.enrichmentWindowHours)) continue;
      const bondAmount = (doc as any)?.bond_amount || (doc as any)?.bond || 0;
      if (typeof bondAmount === 'number' && bondAmount < config.bondThreshold) continue;
      const since = new Date(Date.now() - config.idempotencyWindowSeconds * 1000);
      const existing = await EnrichmentJobModel.findOne({ subjectId, status: 'SUCCEEDED', updatedAt: { $gte: since } });
      if (existing) continue;
      const active = await EnrichmentJobModel.findOne({ subjectId, status: { $in: ['NEW', 'READY', 'RUNNING'] } });
      if (active) continue;
      const job = await queue.add('enrich', { subjectId, mode: 'standard' }, { removeOnComplete: true, removeOnFail: false, jobId: `${subjectId}:standard` });
      await EnrichmentJobModel.create({ jobId: job.id, subjectId, status: 'READY', steps: [], progress: 0, logs: [], errors: [], idempotencyKey: `${subjectId}:v1` });
      logger.info('Sweep enqueued enrichment', { subjectId, jobId: job.id });
    }
  });
  job.start();
  logger.info('Sweep started', { cron: config.autoEnrichSweepCron });
}
