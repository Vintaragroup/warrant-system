import dotenv from 'dotenv';
dotenv.config();

export const config = {
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/inmatesdb',
  mongoDbName: process.env.MONGO_DB || process.env.MONGO_DB_NAME || 'inmatesdb',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  port: Number(process.env.PORT || 4000),
  enrichmentWindowHours: Number(process.env.ENRICHMENT_WINDOW_HOURS || 72),
  idempotencyWindowSeconds: Number(process.env.IDEMPOTENCY_WINDOW_SECONDS || 600),
  pdlApiKey: process.env.PDL_API_KEY,
  whitepagesApiKey: process.env.WHITEPAGES_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  piplApiKey: process.env.PIPL_API_KEY,
  // Provider enable toggles (default enabled when key present, can override)
  providerPdlEnabled: (process.env.PROVIDER_PDL_ENABLED || (process.env.PDL_API_KEY ? 'true' : 'false')).toLowerCase() === 'true',
  providerWhitepagesEnabled: (process.env.PROVIDER_WHITEPAGES_ENABLED || (process.env.WHITEPAGES_API_KEY ? 'true' : 'false')).toLowerCase() === 'true',
  providerOpenaiEnabled: (process.env.PROVIDER_OPENAI_ENABLED || (process.env.OPENAI_API_KEY ? 'true' : 'false')).toLowerCase() === 'true',
  providerPiplEnabled: (process.env.PROVIDER_PIPL_ENABLED || (process.env.PIPL_API_KEY ? 'true' : 'false')).toLowerCase() === 'true',
  // Provider rate limits and budgets
  pdlMaxRps: Number(process.env.PDL_MAX_RPS || 3),
  pdlMaxPerHour: Number(process.env.PDL_MAX_PER_HOUR || 500),
  pdlMaxPerDay: Number(process.env.PDL_MAX_PER_DAY || 3000),
  piplMaxRps: Number(process.env.PIPL_MAX_RPS || 3),
  piplMaxPerHour: Number(process.env.PIPL_MAX_PER_HOUR || 500),
  piplMaxPerDay: Number(process.env.PIPL_MAX_PER_DAY || 3000),
  wpMaxRps: Number(process.env.WP_MAX_RPS || 3),
  wpMaxPerHour: Number(process.env.WP_MAX_PER_HOUR || 500),
  wpMaxPerDay: Number(process.env.WP_MAX_PER_DAY || 3000),
  providerMaxRetries: Number(process.env.PROVIDER_MAX_RETRIES || 2),
  providerInitialBackoffMs: Number(process.env.PROVIDER_INITIAL_BACKOFF_MS || 400),
  providerBackoffFactor: Number(process.env.PROVIDER_BACKOFF_FACTOR || 2),
  providerJitterMs: Number(process.env.PROVIDER_JITTER_MS || 150),
  autoEnrichEnabled: (process.env.AUTO_ENRICH_ENABLED || 'false').toLowerCase() === 'true',
  autoEnrichSweepCron: process.env.AUTO_ENRICH_SWEEP_CRON || '*/5 * * * *',
  rawPayloadTtlHours: Number(process.env.RAW_PAYLOAD_TTL_HOURS || 72),
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY || 2),
  nodeEnv: process.env.NODE_ENV || 'development',
  subjectsCollection: process.env.SUBJECTS_COLLECTION || 'inmates',
  bondThreshold: Number(process.env.BOND_THRESHOLD || 1000),
  // HCSO scraping
  hcsoEnabled: (process.env.HCSO_SCRAPE_ENABLED || 'false').toLowerCase() === 'true',
  hcsoBaseUrl: process.env.HCSO_BASE_URL || 'https://www.harriscountyso.org',
  hcsoMode: (process.env.HCSO_SCRAPE_MODE || 'http').toLowerCase() as 'browser' | 'http',
    // Provider budgets/costs
    pdlUnitCostUsd: Number(process.env.PDL_UNIT_COST_USD || 0),
  piplUnitCostUsd: Number(process.env.PIPL_UNIT_COST_USD || 0),
    wpUnitCostUsd: Number(process.env.WP_UNIT_COST_USD || 0),
    // Enrichment behavior toggles
    partyPullPreferStatewide: (process.env.PARTY_PULL_PREFER_STATEWIDE || 'false').toLowerCase() === 'true',
};
