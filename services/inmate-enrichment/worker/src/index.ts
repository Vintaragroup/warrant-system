import { Worker, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config, connectMongo, logger } from '@inmate/shared';
import { InmateModel, EnrichmentJobModel, RelatedPartyModel } from '@inmate/shared';
import { runPipeline } from './pipeline';

async function main() {
  await connectMongo();
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    'enrichment',
    async (job: Job) => {
  const { subjectId, mode, runOpts } = job.data as { subjectId: string; mode: 'standard' | 'deep' | 'dob-only'; runOpts?: { windowHoursOverride?: number; minBondOverride?: number } };
      // Idempotent upsert of the job document to avoid duplicate key errors
      await EnrichmentJobModel.updateOne(
        { jobId: String(job.id) },
        {
          $set: { status: 'RUNNING' },
          $setOnInsert: { jobId: String(job.id), subjectId, steps: [], progress: 0, logs: [], errors: [], idempotencyKey: `${subjectId}_v1` },
        },
        { upsert: true }
      );
      try {
  const res = await runPipeline({ subjectId, mode, jobId: String(job.id), runOpts });
        const latest = await EnrichmentJobModel.findOne({ jobId: job.id });
        if (latest) {
          latest.status = res.partial ? 'PARTIAL' : 'SUCCEEDED';
          latest.progress = 100;
          latest.logs?.push('Pipeline complete');
          await latest.save();
        }
        await InmateModel.updateOne(
          { $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] },
          { $set: { enrichment_status: res.partial ? 'PARTIAL' : 'SUCCEEDED', enrichment_last_run_at: new Date() } }
        );
      } catch (err) {
        const latest = await EnrichmentJobModel.findOne({ jobId: job.id });
        if (latest) {
          latest.status = 'FAILED';
          latest.errors?.push(String(err));
          await latest.save();
        }
        throw err;
      }
    },
    { connection, concurrency: config.queueConcurrency, autorun: true }
  );

  const events = new QueueEvents('enrichment', { connection });
  events.on('failed', ({ jobId, failedReason }: any) => {
    logger.error('Job failed', { jobId, failedReason });
  });
  events.on('completed', ({ jobId }: any) => {
    logger.info('Job completed', { jobId });
  });

  logger.info('Worker started', { concurrency: config.queueConcurrency });
}
// Simple in-process budget counters (reset on worker restart). For production
// consider Redis-based rate limiting and counters per time window.
let pdlCallsHour = 0, pdlCallsDay = 0;
let wpCallsHour = 0, wpCallsDay = 0;
let hourStarted = Date.now(), dayStarted = Date.now();
function resetWindows(){
  const now = Date.now();
  if (now - hourStarted > 3600_000) { pdlCallsHour = 0; wpCallsHour = 0; hourStarted = now; }
  if (now - dayStarted > 86_400_000) { pdlCallsDay = 0; wpCallsDay = 0; dayStarted = now; }
}
export function providerBudgetGuard(kind: 'pdl'|'wp'): boolean {
  resetWindows();
  if (kind==='pdl') {
    return pdlCallsHour < (config as any).pdlMaxPerHour && pdlCallsDay < (config as any).pdlMaxPerDay;
  }
  return wpCallsHour < (config as any).wpMaxPerHour && wpCallsDay < (config as any).wpMaxPerDay;
}
export function providerBudgetCount(kind: 'pdl'|'wp'){
  resetWindows();
  if (kind==='pdl'){ pdlCallsHour++; pdlCallsDay++; }
  else { wpCallsHour++; wpCallsDay++; }
}

main().catch((e) => {
  logger.error('Worker fatal error', { e: String(e), stack: (e as any)?.stack });
  process.exit(1);
});
