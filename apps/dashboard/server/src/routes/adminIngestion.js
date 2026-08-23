/**
 * routes/adminIngestion.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Admin API for scraper operations: status, run history, config, manual runs.
 *
 * All routes require authentication (requireAuth) and Admin/SuperUser role
 * (requireAdmin defined below).
 *
 * Mounted at: /api/admin/ingestion
 *
 * SECURITY:
 *  - MONGO_URI and secrets are never returned in any response body
 *  - Manual run output is capped and redacted before storage
 *  - Non-dry-run writes require ALLOW_ADMIN_NON_DRY_RUN=true env var
 *  - Production mode is rejected — only staging is allowed from the admin UI
 *  - Source names are validated against an allowlist
 *  - Numeric limits are clamped to safe ranges per source
 *
 * TODO: When role permissions are expanded, replace the inline requireAdmin
 *       check with assertPermission(req, 'ingestion:manage') and add
 *       'ingestion:manage' to ROLE_PERMISSIONS for Admin/SuperUser in roles.js.
 */

import { Router } from 'express';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import mongoose from 'mongoose';

const r = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_SOURCES = [
  'galveston',
  'harris_reports',
  'wharton',
  'fortbend_lookup',
  'jefferson_lookup',
  'brazoria_lookup',
  'harris_sheriff_enrichment',
];

// Per-source maximum limit for manual runs
const SOURCE_MAX_LIMITS = {
  galveston: 500,
  harris_reports: 4,
  wharton: 500,
  fortbend_lookup: 100,
  jefferson_lookup: 100,
  brazoria_lookup: 100,
  harris_sheriff_enrichment: 500,
};

// Staging collection names per source (for status display)
const SOURCE_STAGING_COLLECTIONS = {
  galveston: 'v2_galveston_events',
  harris_reports: 'v2_harris_reports',
  wharton: 'v2_wharton_events',
  fortbend_lookup: 'v2_lookup_results',
  jefferson_lookup: 'v2_jefferson_events',
  brazoria_lookup: 'v2_lookup_results',
  harris_sheriff_enrichment: 'harris_sheriff_enrichments',
};

const SOURCE_LIVE_COLLECTIONS = {
  galveston: 'simple_galveston',
  harris_reports: 'simple_harris',
  wharton: 'simple_wharton',
  fortbend_lookup: 'simple_fortbend',
  jefferson_lookup: 'simple_jefferson',
  brazoria_lookup: 'simple_brazoria',
};

const ADMIN_CONFIG_COLLECTION = 'admin_config';
const INGESTION_RUNS_COLLECTION = 'ingestion_runs';

// Max tail bytes stored/returned per run output
const OUTPUT_TAIL_CHARS = 4000;

// ── Job Store ─────────────────────────────────────────────────────────────────
const _jobStore = new Map();      // jobId → job object
const _jobProcesses = new Map();  // jobId → ChildProcess (while running)
const JOBS_COLLECTION = 'ingestion_jobs';

function _createJob({ source, mode, dry_run, created_by = 'admin' }) {
  const jobId = randomUUID();
  const job = {
    job_id: jobId, status: 'queued', source, mode, dry_run, created_by,
    current_prefix: null, prefixes_total: 676, prefixes_checked: 0,
    percent_complete: 0, elapsed_seconds: 0, estimated_seconds_remaining: null,
    seen: 0, details_checked: 0, recent_matches: 0, written: 0,
    stale_cached: 0, skipped_cached: 0, skipped: 0, errors: 0,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    completed_at: null, stdout_tail: '', stderr_tail: '',
  };
  _jobStore.set(jobId, job);
  _persistJob(job).catch(() => {});
  return job;
}

function _updateJob(jobId, updates) {
  const job = _jobStore.get(jobId);
  if (!job) return null;
  Object.assign(job, updates, { updated_at: new Date().toISOString() });
  if (updates.status || updates.completed_at) { _persistJob(job).catch(() => {}); }
  return job;
}

async function _persistJob(job) {
  try {
    const db = getDb();
    await db.collection(JOBS_COLLECTION).replaceOne(
      { job_id: job.job_id },
      { ...job, _persisted_at: new Date().toISOString() },
      { upsert: true },
    );
  } catch { /* best-effort */ }
}

// Pipeline root — set PIPELINE_ROOT env var to the absolute path of
// services/warrantdb-pipeline. Falls back to a relative path from the
// server process for local monorepo development.
const PIPELINE_ROOT = process.env.PIPELINE_ROOT
  || path.resolve(process.cwd(), '../../services/warrantdb-pipeline');

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * requireAdmin — server-side Admin/SuperUser role enforcement.
 *
 * Must be applied after requireAuth so req.user is populated.
 * Returns 403 if the authenticated user does not have Admin or SuperUser role.
 *
 * TODO: replace with assertPermission(req, 'ingestion:manage') once that
 *       permission is added to ROLE_PERMISSIONS in lib/roles.js.
 */
function requireAdmin(req, res, next) {
  const roles = req.user?.roles || [];
  if (
    roles.includes('Admin') ||
    roles.includes('SuperUser') ||
    roles.includes('Super Admin') ||
    roles.includes('super_admin')
  ) {
    return next();
  }
  return res.status(403).json({
    ok: false,
    error: 'FORBIDDEN',
    message: 'Admin or SuperUser role required',
  });
}

// Apply auth + admin check to all routes in this router
r.use(requireAdmin);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDb() {
  const db = mongoose.connection?.db;
  if (!db) throw new Error('MongoDB not connected');
  return db;
}

function validateSource(source) {
  if (!SUPPORTED_SOURCES.includes(source)) {
    throw Object.assign(new Error(`Unsupported source: ${source}`), {
      statusCode: 400,
      code: 'INVALID_SOURCE',
    });
  }
}

function clampLimit(source, limit) {
  const max = SOURCE_MAX_LIMITS[source] || 100;
  return Math.min(Math.max(1, Math.floor(Number(limit) || 20)), max);
}

/**
 * Redact secret-looking values from a string before storing or returning it.
 */
function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/mongodb\+srv:\/\/[^\s@]+@\S+/gi, 'mongodb+srv://[REDACTED]')
    .replace(/mongodb:\/\/[^\s@]+@\S+/gi, 'mongodb://[REDACTED]')
    .replace(/(MONGO_URI|MONGO_URL|DATABASE_URL|API_KEY|SECRET|PASSWORD|TOKEN)=\S+/gi, '$1=[REDACTED]');
}

function tailOutput(text) {
  if (!text || text.length <= OUTPUT_TAIL_CHARS) return text || '';
  return '...[truncated]\n' + text.slice(-OUTPUT_TAIL_CHARS);
}

/**
 * Safely determine whether a staging collection is stale.
 * Staleness thresholds match check_v2_staging_health.py:
 *   galveston → 1 hour, harris/others → 26 hours
 */
function isStale(latestAt, source) {
  if (!latestAt) return true;
  const thresholdHours = source === 'galveston' ? 1 : 26;
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  const ts = new Date(latestAt).getTime();
  return Date.now() - ts > thresholdMs;
}

// ── Output count parser ─────────────────────────────────────────────────────

/**
 * Parse the structured INGESTION_RESULT_JSON line emitted by run_ingestion_v2.py.
 * Returns the parsed object, or null if not found / malformed.
 */
function parseStructuredResult(stdout, stdoutHead) {
  const combined = `${stdoutHead || ''}\n${stdout || ''}`;
  const lines = combined.split(/\r?\n/);
  const resultLine = [...lines].reverse().find((line) =>
    line.startsWith('INGESTION_RESULT_JSON='),
  );
  if (!resultLine) return null;
  try {
    return JSON.parse(resultLine.slice('INGESTION_RESULT_JSON='.length));
  } catch {
    return null;
  }
}

/**
 * Parse seen/written record counts from Python script stdout.
 * Handles galveston, harris, and wharton output formats.
 * Used as fallback when structured JSON is not available.
 */
function parseOutputCounts(stdout, stdoutHead, dryRun) {
  let seen = null;
  let written = null;
  // Combine head + tail so count lines at either end are found
  const fullSearch = (stdoutHead || '') + '\n' + (stdout || '');
  const dryRunSummaryMatch = fullSearch.match(/dry-run summary: ok=(\d+)/i);
  const harrisFoundMatch   = fullSearch.match(/found (\d+) reports on datasets page/i);
  const storedEventsMatch  = fullSearch.match(/stored (\d+) events/i);
  const harrisStoredMatch  = fullSearch.match(/total records stored[: ]+(\d+)/i);
  if (dryRun) {
    if (dryRunSummaryMatch) seen = parseInt(dryRunSummaryMatch[1], 10);
    else if (harrisFoundMatch) seen = parseInt(harrisFoundMatch[1], 10);
    written = 0;
  } else {
    if (storedEventsMatch) { seen = parseInt(storedEventsMatch[1], 10); written = seen; }
    if (harrisStoredMatch) { seen = parseInt(harrisStoredMatch[1], 10); written = seen; }
  }
  return { seen, written };
}

// ── Audit record writer ───────────────────────────────────────────────────────

/**
 * Write an ingestion_runs audit record. Never throws — audit failures must
 * not crash or block ingestion.
 */
async function writeAuditRecord(db, record) {
  try {
    const runId = `${record.source}-${record.trigger}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.collection(INGESTION_RUNS_COLLECTION).insertOne({
      run_id: runId,
      ...record,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[adminIngestion] audit write failed:', err.message);
  }
}

// ── Background job runner for Fort Bend auto-discovery ────────────────────────
function _spawnAutoDiscovery(jobId, pyArgs, childEnv, createdBy, redactedCmd) {
  _updateJob(jobId, { status: 'running' });

  const child = spawn('python3', pyArgs, {
    cwd: PIPELINE_ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  _jobProcesses.set(jobId, child);

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let stderrBuf = '';
  let stdoutBuf = '';

  rl.on('line', (line) => {
    stdoutBuf += line + '\n';
    if (stdoutBuf.length > OUTPUT_TAIL_CHARS * 2) stdoutBuf = stdoutBuf.slice(-OUTPUT_TAIL_CHARS * 2);

    if (line.startsWith('PROGRESS_JSON=')) {
      try {
        const p = JSON.parse(line.slice('PROGRESS_JSON='.length));
        const checked = p.prefixes_checked || 0;
        const total = 676;
        const elapsed = p.elapsed_seconds || 0;
        const pct = Math.round((checked / total) * 1000) / 10;
        const avgPerPrefix = checked > 0 ? elapsed / checked : 0;
        const remaining = avgPerPrefix > 0 ? Math.round(avgPerPrefix * (total - checked)) : null;
        _updateJob(jobId, {
          current_prefix: (p.current_prefix || '').toUpperCase() || null,
          prefixes_checked: checked,
          percent_complete: pct,
          elapsed_seconds: elapsed,
          estimated_seconds_remaining: remaining,
          seen: p.seen || 0, details_checked: p.details_checked || 0,
          recent_matches: p.recent_matches || 0, written: p.written || 0,
          stale_cached: p.stale_cached || 0, skipped_cached: p.skipped_cached || 0,
          skipped: p.skipped || 0, errors: p.errors || 0,
        });
      } catch { /* ignore parse errors */ }
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > OUTPUT_TAIL_CHARS * 2) stderrBuf = stderrBuf.slice(-OUTPUT_TAIL_CHARS * 2);
  });

  child.on('close', (exitCode) => {
    _jobProcesses.delete(jobId);
    const job = _jobStore.get(jobId);
    if (!job || job.status === 'cancelled') return;

    const structured = parseStructuredResult(stdoutBuf, stdoutBuf);
    const finalStatus = exitCode === 0 ? 'completed' : 'failed';
    const finalPrefixesChecked = structured?.prefixes_checked ?? job.prefixes_checked ?? 0;
    const completedFullSweep = finalStatus === 'completed' && finalPrefixesChecked >= 676;
    _updateJob(jobId, {
      status: finalStatus,
      completed_at: new Date().toISOString(),
      seen: structured?.seen ?? job.seen,
      written: structured?.written ?? job.written,
      prefixes_checked: finalPrefixesChecked,
      prefixes_total: 676,
      completed_full_sweep: completedFullSweep,
      percent_complete: finalStatus === 'completed' ? 100 : job.percent_complete,
      stdout_tail: tailOutput(redactSecrets(stdoutBuf)),
      stderr_tail: tailOutput(redactSecrets(stderrBuf)),
    });

    try {
      const db = getDb();
      writeAuditRecord(db, {
        source: job.source,
        trigger: job.dry_run ? 'manual_dry_run' : 'manual',
        status: finalStatus === 'completed' ? 'success' : 'failed',
        dry_run: job.dry_run,
        started_at: job.started_at,
        completed_at: new Date().toISOString(),
        records_seen: structured?.seen ?? job.seen,
        records_written: structured?.written ?? job.written,
        exit_code: exitCode,
        command_summary: redactedCmd,
        created_by: createdBy,
        job_id: jobId,
      });
    } catch { /* ignore */ }
  });

  // Hard timeout: 35 minutes for full aa-zz run
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    _updateJob(jobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      stderr_tail: 'Job timed out after 35 minutes',
    });
  }, 35 * 60 * 1000);
  child.on('close', () => clearTimeout(timer));
}

// ── GET /api/admin/ingestion/status ──────────────────────────────────────────

r.get('/status', async (req, res) => {
  try {
    const db = getDb();
    const results = await Promise.all(
      SUPPORTED_SOURCES.map(async (source) => {
        // Load scheduler config
        const config = await db.collection(ADMIN_CONFIG_COLLECTION).findOne(
          { type: 'ingestion_source', source },
          { projection: { _id: 0 } },
        );

        // Load run history summary
        const [lastRun, lastSuccess, lastError] = await Promise.all([
          db.collection(INGESTION_RUNS_COLLECTION).findOne(
            { source },
            { projection: { _id: 0 }, sort: { started_at: -1 } },
          ),
          db.collection(INGESTION_RUNS_COLLECTION).findOne(
            { source, status: 'success' },
            { projection: { _id: 0 }, sort: { started_at: -1 } },
          ),
          db.collection(INGESTION_RUNS_COLLECTION).findOne(
            { source, status: 'failed' },
            { projection: { _id: 0 }, sort: { started_at: -1 } },
          ),
        ]);

        // Staging collection doc count + latest doc
        const stagingColl = SOURCE_STAGING_COLLECTIONS[source];
        let stagingCount = null;
        let stagingLatestAt = null;
        let stale = null;
        try {
          stagingCount = await db.collection(stagingColl).estimatedDocumentCount();
          const latestDoc = await db.collection(stagingColl).findOne(
            {},
            { projection: { normalized_at: 1, scraped_at: 1, _id: 0 }, sort: { _id: -1 } },
          );
          stagingLatestAt = latestDoc?.normalized_at || latestDoc?.scraped_at || null;
          stale = isStale(stagingLatestAt, source);
        } catch {
          // Collection may not exist yet — that's fine
        }

        return {
          source,
          enabled: config?.enabled ?? false,
          mode: config?.mode ?? 'staging',
          schedule: config?.schedule ?? null,
          last_run: lastRun,
          last_success: lastSuccess,
          last_error: lastError,
          staging_collection: stagingColl,
          staging_count: stagingCount,
          staging_latest_at: stagingLatestAt,
          stale,
          current_collection: SOURCE_LIVE_COLLECTIONS[source],
          v2_read_enabled: config?.read_flags?.use_galveston_v2_reads ?? false,
        };
      }),
    );
    return res.json({ ok: true, sources: results, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[adminIngestion] /status error:', err.message);
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
});

// ── GET /api/admin/ingestion/runs ─────────────────────────────────────────────

r.get('/runs', async (req, res) => {
  try {
    const db = getDb();
    const source = req.query.source || null;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));

    if (source) validateSource(source);

    const query = source ? { source } : {};
    const runs = await db.collection(INGESTION_RUNS_COLLECTION)
      .find(query, { projection: { _id: 0 } })
      .sort({ started_at: -1 })
      .limit(limit)
      .toArray();

    return res.json({ ok: true, runs, count: runs.length });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
});

// ── GET /api/admin/ingestion/errors ──────────────────────────────────────────

r.get('/errors', async (req, res) => {
  try {
    const db = getDb();
    const source = req.query.source || null;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));

    if (source) validateSource(source);

    // Only real failures — skip/dry-run entries belong in Run History, not Errors
    const query = {
      status: 'failed',
      ...(source ? { source } : {}),
    };
    const errors = await db.collection(INGESTION_RUNS_COLLECTION)
      .find(query, { projection: { _id: 0 } })
      .sort({ started_at: -1 })
      .limit(limit)
      .toArray();

    return res.json({ ok: true, errors, count: errors.length });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
});

// ── GET /api/admin/ingestion/config ──────────────────────────────────────────

r.get('/config', async (req, res) => {
  try {
    const db = getDb();
    const source = req.query.source || null;

    if (source) validateSource(source);

    const query = source
      ? { type: 'ingestion_source', source }
      : { type: 'ingestion_source' };

    const configs = await db.collection(ADMIN_CONFIG_COLLECTION)
      .find(query, { projection: { _id: 0 } })
      .toArray();

    // Fill in defaults for any sources not yet seeded
    const result = SUPPORTED_SOURCES
      .filter((s) => !source || s === source)
      .map((s) => {
        const stored = configs.find((c) => c.source === s);
        return stored || { source: s, _note: 'not yet seeded — run ensure_default_configs' };
      });

    return res.json({ ok: true, configs: result });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
});

// ── POST /api/admin/ingestion/config ─────────────────────────────────────────

r.post('/config', async (req, res) => {
  try {
    const db = getDb();
    const { source, patch } = req.body || {};

    if (!source) {
      return res.status(400).json({ ok: false, error: 'MISSING_SOURCE', message: 'source is required' });
    }
    validateSource(source);

    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ ok: false, error: 'MISSING_PATCH', message: 'patch object is required' });
    }

    // ── Validation ────────────────────────────────────────────────────────────
    // Reject production mode — only staging writes allowed from the admin UI
    if (patch.mode === 'production') {
      return res.status(400).json({
        ok: false,
        error: 'PRODUCTION_MODE_REJECTED',
        message: 'Production mode cannot be set from the admin UI. Only staging is allowed.',
      });
    }

    // Validate schedule sub-fields if present
    if (patch.schedule) {
      const { interval_minutes, max_runs_per_day } = patch.schedule;
      if (interval_minutes !== undefined && interval_minutes !== null) {
        const iv = Number(interval_minutes);
        if (!Number.isInteger(iv) || iv < 1 || iv > 1440) {
          return res.status(400).json({
            ok: false,
            error: 'INVALID_INTERVAL',
            message: 'interval_minutes must be an integer between 1 and 1440',
          });
        }
      }
      if (max_runs_per_day !== undefined && max_runs_per_day !== null) {
        const mx = Number(max_runs_per_day);
        if (!Number.isInteger(mx) || mx < 0 || mx > 1440) {
          return res.status(400).json({
            ok: false,
            error: 'INVALID_MAX_RUNS',
            message: 'max_runs_per_day must be an integer between 0 and 1440',
          });
        }
      }
    }

    // Build flattened $set with dot-notation keys
    const flat = flattenPatch(patch);
    flat['updated_at'] = new Date().toISOString();
    flat['updated_by'] = req.user?.uid || req.user?.email || 'admin';
    flat['type'] = 'ingestion_source';
    flat['source'] = source;

    await db.collection(ADMIN_CONFIG_COLLECTION).updateOne(
      { type: 'ingestion_source', source },
      { $set: flat },
      { upsert: true },
    );

    const updated = await db.collection(ADMIN_CONFIG_COLLECTION).findOne(
      { type: 'ingestion_source', source },
      { projection: { _id: 0 } },
    );

    return res.json({ ok: true, source, updated });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
});

// ── POST /api/admin/ingestion/run ─────────────────────────────────────────────

r.post('/run', async (req, res) => {
  const {
    source,
    dry_run: dryRunParam = true,
    limit: limitParam = 20,
    first_name: firstName = '',
    last_name: lastName = '',
    booking_date: bookingDate = '',
    force = false,
    bulk = false,
    // Fort Bend discovery params
    mode: legacyMode,
    discoveryMode: discoveryModeParam,
    firstPrefix = '',
    lastPrefix = '',
    windowDays = 7,
    verifySample = 5,
    // Harris Sheriff enrichment params
    spn = '',
    seed = '',
  } = req.body || {};

  // Accept both `discoveryMode` (new) and `mode` (legacy) field names
  const discoveryMode = discoveryModeParam || legacyMode || 'name';

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!source) {
    return res.status(400).json({ ok: false, error: 'MISSING_SOURCE', message: 'source is required' });
  }
  try { validateSource(source); } catch (err) {
    return res.status(400).json({ ok: false, error: err.code, message: err.message });
  }

  const dryRun = dryRunParam !== false && dryRunParam !== 'false';

  // Block non-dry-run unless explicitly allowed by env
  const allowNonDryRun = String(process.env.ALLOW_ADMIN_NON_DRY_RUN || 'false').toLowerCase() === 'true';
  if (!dryRun && !allowNonDryRun) {
    return res.status(403).json({
      ok: false,
      error: 'NON_DRY_RUN_BLOCKED',
      message: 'Non-dry-run is disabled. Set ALLOW_ADMIN_NON_DRY_RUN=true to enable staging writes from the admin UI.',
    });
  }

  // Jefferson: if running from bulk (no last_name, no booking_date), default to today.
  // This allows the bulk button to trigger jefferson without manual params.
  const effectiveBookingDate = (source === 'jefferson_lookup' && !lastName && !bookingDate)
    ? 'today'
    : bookingDate;

  // Lookup sources require last_name OR (jefferson only) booking_date
  // Fort Bend discovery modes (prefix/seed) don't need last_name
  const isLookup = source.endsWith('_lookup');
  const jeffersonDateMode = source === 'jefferson_lookup' && (!!effectiveBookingDate || !lastName);
  const isFortbendDiscovery =
    source === 'fortbend_lookup' &&
    (discoveryMode === 'prefix' || discoveryMode === 'seed' || discoveryMode === 'auto' ||
     discoveryMode === 'verify' || firstPrefix || lastPrefix);
  if (isLookup && !lastName && !jeffersonDateMode && !isFortbendDiscovery) {
    return res.status(400).json({
      ok: false,
      error: 'MISSING_LAST_NAME',
      message: source === 'jefferson_lookup'
        ? `jefferson_lookup requires last_name or booking_date (source=${source})`
        : source === 'fortbend_lookup'
          ? 'fortbend_lookup requires last_name, prefix pair, or mode=seed'
          : `last_name is required for lookup sources (source=${source})`,
    });
  }

  // brazoria_lookup also requires first_name — Tyler's server rejects name-only searches
  if (source === 'brazoria_lookup' && !firstName) {
    return res.status(400).json({
      ok: false,
      error: 'MISSING_FIRST_NAME',
      message: 'brazoria_lookup requires both last_name and first_name (Tyler PublicAccess rejects searches without a first name)',
    });
  }

  const limit = clampLimit(source, limitParam);
  // For Fort Bend auto-discovery, limit=0 means full aa–zz sweep (no row cap).
  // clampLimit converts 0→20 via `Number(0)||20`, so we bypass it for this case.
  const effectiveLimit = (source === 'fortbend_lookup' && discoveryMode === 'auto' && Number(limitParam) <= 0)
    ? 0
    : limit;
  const createdBy = req.user?.uid || req.user?.email || 'admin';

  // ── Locate pipeline root ────────────────────────────────────────────────────
  try {
    const { existsSync } = await import('node:fs');
    const runnerPath = path.join(PIPELINE_ROOT, 'scripts', 'run_ingestion_v2.py');
    if (!existsSync(runnerPath)) {
      return res.status(503).json({
        ok: false,
        error: 'PIPELINE_NOT_FOUND',
        message: `Pipeline runner not found at ${runnerPath}. Set PIPELINE_ROOT env var to the absolute path of services/warrantdb-pipeline.`,
      });
    }
  } catch (err) {
    return res.status(503).json({
      ok: false,
      error: 'PIPELINE_CHECK_FAILED',
      message: `Could not check for pipeline runner: ${err.message}`,
    });
  }

  // ── Build command args ──────────────────────────────────────────────────────
  const pyArgs = [
    path.join(PIPELINE_ROOT, 'scripts', 'run_ingestion_v2.py'),
    '--source', source,
    '--limit', String(effectiveLimit),
    '--trigger', 'manual',
    '--created-by', createdBy,
  ];

  if (dryRun) {
    pyArgs.push('--dry-run');
  } else {
    pyArgs.push('--no-dry-run');
  }

  if (force) pyArgs.push('--force');
  if (firstName) { pyArgs.push('--first-name', firstName); }
  if (lastName) { pyArgs.push('--last-name', lastName); }
  if (effectiveBookingDate) { pyArgs.push('--booking-date', effectiveBookingDate); }

  // Fort Bend discovery additional args
  if (source === 'fortbend_lookup') {
    if (discoveryMode && discoveryMode !== 'name') { pyArgs.push('--mode', discoveryMode); }
    if (firstPrefix) { pyArgs.push('--first-prefix', String(firstPrefix)); }
    if (lastPrefix) { pyArgs.push('--last-prefix', String(lastPrefix)); }
    if (windowDays && Number(windowDays) !== 7) { pyArgs.push('--window-days', String(Number(windowDays))); }
    if (discoveryMode === 'verify') { pyArgs.push('--verify-sample', String(Number(verifySample) || 5)); }
  }

  // Harris Sheriff enrichment additional args
  if (source === 'harris_sheriff_enrichment') {
    if (spn) { pyArgs.push('--spn', String(spn).trim()); }
    else {
      // Batch mode — seed from recent_harris, respect caller's window
      pyArgs.push('--seed', seed || 'recent_harris');
      const wd = Math.min(Math.max(1, Number(windowDays) || 7), 90);
      pyArgs.push('--window-days', String(wd));
      if (force) pyArgs.push('--force');
    }
  }

  // Redacted command for logging (never include secrets)
  const redactedCmd = `python3 scripts/run_ingestion_v2.py --source ${source} --limit ${effectiveLimit} --trigger manual${dryRun ? ' --dry-run' : ' --no-dry-run'}`;

  // ── Async background job: Fort Bend auto-discovery ─────────────────────────
  if (isFortbendDiscovery && discoveryMode === 'auto') {
    const job = _createJob({ source, mode: 'auto', dry_run: dryRun, created_by: createdBy });
    const asyncEnv = {
      ...process.env,
      PYTHONPATH: PIPELINE_ROOT,
      USE_V2_INGESTION: dryRun ? 'false' : 'true',
      DRY_RUN: dryRun ? 'true' : 'false',
    };
    _spawnAutoDiscovery(job.job_id, pyArgs, asyncEnv, createdBy, redactedCmd);
    return res.json({ ok: true, job_id: job.job_id, status: 'queued' });
  }

  const startedAtMs = Date.now();
  const startedAt = new Date().toISOString();

  // ── Spawn child process ─────────────────────────────────────────────────────
  const childEnv = {
    ...process.env,
    PYTHONPATH: PIPELINE_ROOT,
    // Ensure the scraper does not accidentally write to production
    USE_V2_INGESTION: dryRun ? 'false' : 'true',
    DRY_RUN: dryRun ? 'true' : 'false',
  };
  // Never log the env object — it contains MONGO_URI

  let stdout = '';
  let stderr = '';
  let exitCode = null;

  try {
    await new Promise((resolve, reject) => {
      const child = spawn('python3', pyArgs, {
        cwd: PIPELINE_ROOT,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > OUTPUT_TAIL_CHARS * 2) {
          stdout = stdout.slice(-OUTPUT_TAIL_CHARS * 2);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > OUTPUT_TAIL_CHARS * 2) {
          stderr = stderr.slice(-OUTPUT_TAIL_CHARS * 2);
        }
      });

      child.on('close', (code) => {
        exitCode = code;
        resolve();
      });
      child.on('error', (err) => reject(err));

      // Hard timeout: longer for enrichment sources that make one HTTP request per record
      const timeoutMs = source === 'harris_sheriff_enrichment' ? 25 * 60 * 1000 : 5 * 60 * 1000;
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Run timed out after ${timeoutMs / 60000} minutes`));
      }, timeoutMs);

      child.on('close', () => clearTimeout(timer));
    });
  } catch (spawnErr) {
    return res.status(500).json({
      ok: false,
      error: 'SPAWN_FAILED',
      message: spawnErr.message,
      command: redactedCmd,
    });
  }

  const status = exitCode === 0 ? 'success' : 'failed';

  // Prefer structured JSON result emitted by the Python script
  const structured = parseStructuredResult(stdout, stdout);
  let recordsSeen, recordsWritten, skipped, runMessage;
  let detailsChecked = null, recentMatches = null, staleCached = null;
  let prefixesChecked = null, skippedCached = null, unknownDate = null;
  let dateSearched = null;
  let docsScanned = null, docsWithSpn = null, uniqueSpns = null, eligibleSpns = null;
  if (structured) {
    recordsSeen    = structured.seen ?? null;
    recordsWritten = structured.written ?? null;
    skipped        = structured.skipped ?? 0;
    runMessage     = structured.message ?? null;
    dateSearched   = structured.date_searched ?? null;
    // Fort Bend discovery extra fields
    detailsChecked  = structured.details_checked  ?? null;
    recentMatches   = structured.recent_matches   ?? null;
    staleCached     = structured.stale_cached     ?? null;
    prefixesChecked = structured.prefixes_checked ?? null;
    skippedCached   = structured.skipped_cached   ?? null;
    unknownDate     = structured.unknown_date     ?? null;
    // Harris Sheriff enrichment diagnostics
    docsScanned  = structured.docs_scanned  ?? null;
    docsWithSpn  = structured.docs_with_spn ?? null;
    uniqueSpns   = structured.unique_spns   ?? null;
    eligibleSpns = structured.eligible_spns ?? null;
  } else {
    const counts = parseOutputCounts(stdout, stdout, dryRun);
    recordsSeen    = counts.seen;
    recordsWritten = counts.written;
    skipped        = 0;
    runMessage     = null;
  }

  // Parse VERIFY_DETAIL_JSON lines emitted per detail page
  const verificationDetails = [];
  for (const line of stdout.split('\n')) {
    if (line.startsWith('VERIFY_DETAIL_JSON=')) {
      try {
        const detail = JSON.parse(line.slice('VERIFY_DETAIL_JSON='.length));
        if (verificationDetails.length < 25) verificationDetails.push(detail);
      } catch { /* ignore malformed line */ }
    }
  }

  // Write audit record for every manual admin-triggered run
  try {
    const db = getDb();
    const trigger = bulk
      ? (dryRun ? 'manual_bulk_dry_run' : 'manual_bulk')
      : (dryRun ? 'manual_dry_run' : 'manual');
    await writeAuditRecord(db, {
      source,
      trigger,
      status,
      dry_run: dryRun,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAtMs,
      records_seen: recordsSeen,
      records_written: recordsWritten,
      skipped,
      exit_code: exitCode,
      command_summary: redactedCmd,
      created_by: createdBy,
      message: runMessage,
      error: exitCode !== 0 ? tailOutput(redactSecrets(stderr || stdout)).slice(0, 500) : null,
    });
  } catch (auditErr) {
    console.error('[adminIngestion] /run audit write failed:', auditErr.message);
  }

  return res.json({
    ok: exitCode === 0,
    source,
    dry_run: dryRun,
    bulk,
    limit,
    status,
    exit_code: exitCode,
    seen: recordsSeen,
    written: recordsWritten,
    skipped,
    records_seen: recordsSeen,
    records_written: recordsWritten,
    message: runMessage,
    date_searched: dateSearched,
    // Fort Bend discovery extra fields (null for other sources)
    details_checked:  detailsChecked,
    recent_matches:   recentMatches,
    stale_cached:     staleCached,
    prefixes_checked: prefixesChecked,
    skipped_cached:   skippedCached,
    unknown_date:     unknownDate,
    // Fort Bend verify mode
    verification_details: verificationDetails.length > 0 ? verificationDetails : undefined,
    verification_sample_count: verificationDetails.length > 0 ? verificationDetails.length : undefined,
    // Harris Sheriff enrichment diagnostics
    docs_scanned:  docsScanned,
    docs_with_spn: docsWithSpn,
    unique_spns:   uniqueSpns,
    eligible_spns: eligibleSpns,
    command: redactedCmd,
    stdout_tail: tailOutput(redactSecrets(stdout)),
    stderr_tail: tailOutput(redactSecrets(stderr)),
  });
});

// ── POST /api/admin/ingestion/run-all ────────────────────────────────────────

/**
 * Run all non-lookup sources sequentially. Lookup sources (fortbend, jefferson,
 * brazoria) require name params that aren't available in bulk mode, so they are
 * skipped and marked as such in the results unless the Python script can handle
 * no-name invocations.
 *
 * Body: { limit?: number, dryRun?: boolean }
 * Returns: { ok, results: [{ source, status, seen, written, error }] }
 */
r.post('/run-all', async (req, res) => {
  const { limit: limitParam = 100, dryRun: dryRunParam = false } = req.body || {};

  const dryRun = dryRunParam === true || dryRunParam === 'true';

  // Block non-dry-run unless explicitly allowed by env
  const allowNonDryRun = String(process.env.ALLOW_ADMIN_NON_DRY_RUN || 'false').toLowerCase() === 'true';
  if (!dryRun && !allowNonDryRun) {
    return res.status(403).json({
      ok: false,
      error: 'NON_DRY_RUN_BLOCKED',
      message: 'Non-dry-run is disabled. Set ALLOW_ADMIN_NON_DRY_RUN=true to enable staging writes from the admin UI.',
    });
  }

  // Verify pipeline runner exists once before looping
  try {
    const { existsSync } = await import('node:fs');
    const runnerPath = path.join(PIPELINE_ROOT, 'scripts', 'run_ingestion_v2.py');
    if (!existsSync(runnerPath)) {
      return res.status(503).json({
        ok: false,
        error: 'PIPELINE_NOT_FOUND',
        message: `Pipeline runner not found at ${runnerPath}. Set PIPELINE_ROOT env var.`,
      });
    }
  } catch (err) {
    return res.status(503).json({ ok: false, error: 'PIPELINE_CHECK_FAILED', message: err.message });
  }

  const createdBy = req.user?.uid || req.user?.email || 'admin';
  const results = [];

  // Run all bulk sources: galveston, harris_reports, wharton, jefferson_lookup (synchronous),
  // and fortbend_lookup (async aa–zz discovery job).
  const bulkSources = ['galveston', 'harris_reports', 'wharton', 'jefferson_lookup', 'fortbend_lookup'];
  const skippedLookup = ['brazoria_lookup'];

  for (const source of bulkSources) {
    // ── Fort Bend: queue async auto-discovery (aa–zz prefix sweep) ───────────────
    if (source === 'fortbend_lookup') {
      const fbPyArgs = [
        path.join(PIPELINE_ROOT, 'scripts', 'run_ingestion_v2.py'),
        '--source', 'fortbend_lookup',
        '--limit', '0',
        '--mode', 'auto',
        '--trigger', 'manual',
        '--created-by', createdBy,
        dryRun ? '--dry-run' : '--no-dry-run',
      ];
      const fbEnv = {
        ...process.env,
        PYTHONPATH: PIPELINE_ROOT,
        USE_V2_INGESTION: dryRun ? 'false' : 'true',
        DRY_RUN: dryRun ? 'true' : 'false',
      };
      const fbCmd = `python3 scripts/run_ingestion_v2.py --source fortbend_lookup --limit 0 --mode auto --trigger manual${dryRun ? ' --dry-run' : ' --no-dry-run'}`;
      const fbJob = _createJob({ source: 'fortbend_lookup', mode: 'auto', dry_run: dryRun, created_by: createdBy });
      _spawnAutoDiscovery(fbJob.job_id, fbPyArgs, fbEnv, createdBy, fbCmd);
      // Write a 'running' audit record for the start of the Fort Bend bulk job
      try {
        const db = getDb();
        await writeAuditRecord(db, {
          source: 'fortbend_lookup',
          trigger: dryRun ? 'manual_bulk_dry_run' : 'manual_all',
          status: 'running',
          dry_run: dryRun,
          started_at: new Date().toISOString(),
          completed_at: null,
          records_seen: null,
          records_written: null,
          exit_code: null,
          command_summary: fbCmd,
          created_by: createdBy,
          job_id: fbJob.job_id,
          mode: 'auto',
          scrape_type: 'discovery_bulk',
          data_confidence: 'high_discovery',
        });
      } catch { /* best-effort */ }
      results.push({
        source: 'fortbend_lookup',
        status: 'queued',
        job_id: fbJob.job_id,
        seen: null,
        written: null,
        error: null,
        message: 'Fort Bend full discovery sweep started',
        mode: 'auto',
      });
      continue;
    }

    const limit = clampLimit(source, limitParam);
    // Jefferson bulk: search today as date mode
    const bulkExtraArgs = [];
    if (source === 'jefferson_lookup') {
      bulkExtraArgs.push('--booking-date', 'today');
    }

    const pyArgs = [
      path.join(PIPELINE_ROOT, 'scripts', 'run_ingestion_v2.py'),
      '--source', source,
      '--limit', String(limit),
      '--trigger', 'manual',
      '--created-by', createdBy,
      dryRun ? '--dry-run' : '--no-dry-run',
      ...bulkExtraArgs,
    ];
    const childEnv = {
      ...process.env,
      PYTHONPATH: PIPELINE_ROOT,
      USE_V2_INGESTION: dryRun ? 'false' : 'true',
      DRY_RUN: dryRun ? 'true' : 'false',
    };

    const sourceStartedAtMs = Date.now();
    const sourceStartedAt = new Date().toISOString();
    let stdout = '';
    let stdoutHead = ''; // First 2000 chars — for count-line parsing (not truncated)
    let stderr = '';
    let exitCode = null;

    try {
      await new Promise((resolve, reject) => {
        const child = spawn('python3', pyArgs, {
          cwd: PIPELINE_ROOT,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', (chunk) => {
          const s = chunk.toString();
          if (stdoutHead.length < 2000) stdoutHead += s.slice(0, 2000 - stdoutHead.length);
          stdout += s;
          if (stdout.length > OUTPUT_TAIL_CHARS * 2) stdout = stdout.slice(-OUTPUT_TAIL_CHARS * 2);
        });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > OUTPUT_TAIL_CHARS * 2) stderr = stderr.slice(-OUTPUT_TAIL_CHARS * 2); });
        child.on('close', (code) => { exitCode = code; resolve(); });
        child.on('error', reject);
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Run timed out after 5 minutes')); }, 5 * 60 * 1000);
        child.on('close', () => clearTimeout(timer));
      });

      const structured = parseStructuredResult(stdout, stdoutHead);
      let seen, written, srcSkipped, srcMessage, srcDateSearched;
      if (structured) {
        seen = structured.seen ?? null;
        written = structured.written ?? null;
        srcSkipped = structured.skipped ?? 0;
        srcMessage = structured.message ?? null;
        srcDateSearched = structured.date_searched ?? null;
      } else {
        const counts = parseOutputCounts(stdout, stdoutHead, dryRun);
        seen = counts.seen;
        written = counts.written;
        srcSkipped = 0;
        srcMessage = null;
      }
      const srcStatus = exitCode === 0 ? 'completed' : 'failed';
      const srcError  = exitCode !== 0 ? tailOutput(redactSecrets(stderr || stdout)).slice(0, 300) : null;

      // Write audit record for each bulk source
      try {
        const db = getDb();
        await writeAuditRecord(db, {
          source,
          trigger: dryRun ? 'manual_bulk_dry_run' : 'manual_bulk',
          status: srcStatus === 'completed' ? 'success' : 'failed',
          dry_run: dryRun,
          started_at: sourceStartedAt,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - sourceStartedAtMs,
          records_seen: seen,
          records_written: written,
          skipped: srcSkipped,
          exit_code: exitCode,
          command_summary: `python3 scripts/run_ingestion_v2.py --source ${source} --limit ${limit} --trigger manual${dryRun ? ' --dry-run' : ' --no-dry-run'}`,
          created_by: createdBy,
          message: srcMessage,
          error: srcError,
        });
      } catch (auditErr) {
        console.error(`[adminIngestion] /run-all audit write failed for ${source}:`, auditErr.message);
      }

      results.push({ source, status: srcStatus, seen, written, error: srcError, date_searched: srcDateSearched ?? null });
    } catch (err) {
      // Write failure audit even when spawn itself throws
      try {
        const db = getDb();
        await writeAuditRecord(db, {
          source,
          trigger: dryRun ? 'manual_bulk_dry_run' : 'manual_bulk',
          status: 'failed',
          dry_run: dryRun,
          started_at: sourceStartedAt,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - sourceStartedAtMs,
          records_seen: null,
          records_written: null,
          exit_code: null,
          command_summary: null,
          created_by: createdBy,
          error: err.message,
        });
      } catch { /* ignore */ }
      results.push({ source, status: 'failed', seen: null, written: null, error: err.message });
    }
  }

  // Lookup sources cannot run in bulk mode — report as skipped with appropriate messages
  const skipTs = new Date().toISOString();
  const lookupSkipMessages = {
    brazoria_lookup:  'Requires name + first_name — use Run Individual Source.',
  };
  for (const source of skippedLookup) {
    const skipMsg = lookupSkipMessages[source] || 'Requires name/date params — use Run Individual Source.';
    try {
      const db = getDb();
      await writeAuditRecord(db, {
        source,
        trigger: dryRun ? 'manual_bulk_dry_run' : 'manual_bulk',
        status: 'skipped',
        dry_run: dryRun,
        started_at: skipTs,
        completed_at: skipTs,
        duration_ms: 0,
        records_seen: null,
        records_written: null,
        exit_code: null,
        command_summary: null,
        created_by: createdBy,
        skip_reason: skipMsg,
        error: null,
      });
    } catch (auditErr) {
      console.error(`[adminIngestion] /run-all skip audit failed for ${source}:`, auditErr.message);
    }
    results.push({
      source,
      status: 'skipped',
      seen: null,
      written: null,
      error: skipMsg,
    });
  }

  return res.json({
    ok: results.some((r) => r.status === 'completed'),
    dry_run: dryRun,
    results,
  });
});

// ── GET /api/admin/ingestion/readiness ───────────────────────────────────────

/**
 * Evaluate promotion readiness for all v2 staging sources.
 *
 * Query params:
 *   days (int, default 3) — observation window in days
 *
 * Readiness values per source:
 *   ready        Meets all thresholds for the observation window
 *   watch        Marginal — needs more data
 *   blocked      Hard failure detected
 *   manual-only  Source is not scheduled for continuous ingestion
 *
 * Global overall values:
 *   ready_to_promote  All required sources are ready
 *   watch             Some required sources need more time
 *   blocked           At least one required source has hard failures
 */

const READINESS_RULES = {
  galveston:        { staleHours: 1,  minSuccessRate: 0.95, minDays: 3, required: true },
  harris_reports:   { staleHours: 36, minSuccessRate: 0.95, minDays: 3, required: true },
  wharton:          { staleHours: 4,  minSuccessRate: 0.90, minDays: 3, required: false, alwaysWatch: true },
  jefferson_lookup: { staleHours: 12, minSuccessRate: 0.90, minDays: 3, required: true },
  brazoria_lookup:  { staleHours: 12, minSuccessRate: 0.90, minDays: 3, required: false, alwaysWatch: true },
  fortbend_lookup:  { staleHours: 30, minSuccessRate: 0.90, minDays: 3, required: false, alwaysWatch: true }, // promoted from manual-only 2026-08-23
};

const REQUIRED_SOURCES = Object.entries(READINESS_RULES)
  .filter(([, r]) => r.required)
  .map(([s]) => s);

const DUP_WARNING_THRESHOLD = 50;

r.get('/readiness', async (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(30, Math.max(1, parseInt(req.query.days || '3', 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    const sourceResults = await Promise.all(
      Object.entries(READINESS_RULES).map(async ([source, rules]) => {
        if (rules.manualOnly) {
          return {
            source,
            readiness: 'manual-only',
            blockers: ['source is manual-only — not scheduled for continuous ingestion'],
            total_runs: 0,
            success_count: 0,
            failed_count: 0,
            skipped_count: 0,
            success_rate: null,
            days_observed: 0,
            latest_success: null,
            latest_failure: null,
            stale: null,
            stale_reason: null,
            avg_records_written: null,
            min_records_written: null,
            max_records_written: null,
            duplicate_key_warnings_total: 0,
            required_field_missing_count_total: 0,
          };
        }

        // Query non-dry-run runs within the observation window
        const allRuns = await db.collection(INGESTION_RUNS_COLLECTION)
          .find(
            { source, started_at: { $gte: sinceIso }, dry_run: false },
            { projection: { _id: 0, run_id: 1, status: 1, started_at: 1, records_written: 1, duplicate_key_warnings: 1, required_field_missing_count: 1 } },
          )
          .sort({ started_at: -1 })
          .toArray();

        const successRuns = allRuns.filter((r) => r.status === 'success');
        const failedRuns = allRuns.filter((r) => r.status === 'failed');
        const skippedRuns = allRuns.filter((r) => r.status === 'skipped');

        const total = allRuns.length;
        const successCount = successRuns.length;
        const successRate = total > 0 ? successCount / total : 0;

        const latestSuccess = successRuns[0]?.started_at ?? null;
        const latestFailure = failedRuns[0]?.started_at ?? null;

        // Unique days with at least one success
        const successDays = new Set(
          successRuns.map((r) => r.started_at?.slice(0, 10)).filter(Boolean),
        );
        const daysObserved = successDays.size;

        // Record write stats from successful runs
        const writtenValues = successRuns
          .map((r) => r.records_written ?? 0)
          .filter((v) => v != null);
        const avgRecordsWritten = writtenValues.length
          ? writtenValues.reduce((a, b) => a + b, 0) / writtenValues.length
          : null;
        const minRecordsWritten = writtenValues.length ? Math.min(...writtenValues) : null;
        const maxRecordsWritten = writtenValues.length ? Math.max(...writtenValues) : null;

        const dupWarningsTotal = allRuns.reduce((acc, r) => acc + (r.duplicate_key_warnings ?? 0), 0);
        const missingFieldsTotal = allRuns.reduce((acc, r) => acc + (r.required_field_missing_count ?? 0), 0);

        // Staleness
        let stale = false;
        let staleReason = null;
        if (rules.staleHours != null) {
          if (!latestSuccess) {
            stale = true;
            staleReason = 'no successful run in observation window';
          } else {
            const ageH = (Date.now() - new Date(latestSuccess).getTime()) / 3_600_000;
            if (ageH > rules.staleHours) {
              stale = true;
              staleReason = `latest success is ${ageH.toFixed(1)}h old (threshold ${rules.staleHours}h)`;
            }
          }
        }

        if (rules.alwaysWatch) {
          return {
            source,
            readiness: 'watch',
            blockers: ['source is disabled/optional — enable explicitly to evaluate'],
            total_runs: total,
            success_count: successCount,
            failed_count: failedRuns.length,
            skipped_count: skippedRuns.length,
            success_rate: total > 0 ? Math.round(successRate * 10000) / 10000 : null,
            days_observed: daysObserved,
            latest_success: latestSuccess,
            latest_failure: latestFailure,
            stale,
            stale_reason: staleReason,
            avg_records_written: avgRecordsWritten != null ? Math.round(avgRecordsWritten * 10) / 10 : null,
            min_records_written: minRecordsWritten,
            max_records_written: maxRecordsWritten,
            duplicate_key_warnings_total: dupWarningsTotal,
            required_field_missing_count_total: missingFieldsTotal,
          };
        }

        // Evaluate blockers
        const blockers = [];

        if (total === 0) {
          blockers.push(`no runs in the last ${days} days`);
        }
        if (daysObserved < rules.minDays) {
          blockers.push(`only ${daysObserved} day(s) with successful runs (need ≥${rules.minDays})`);
        }
        if (total > 0 && successRate < rules.minSuccessRate) {
          blockers.push(
            `success rate ${(successRate * 100).toFixed(1)}% is below threshold ${(rules.minSuccessRate * 100).toFixed(0)}%`
            + ` (${successCount}/${total} succeeded)`,
          );
        }
        if (stale) {
          blockers.push(`data is stale: ${staleReason}`);
        }
        if (avgRecordsWritten !== null && avgRecordsWritten === 0) {
          blockers.push('avg_records_written = 0 — ingestion is not writing any records');
        }
        if (dupWarningsTotal >= DUP_WARNING_THRESHOLD) {
          blockers.push(`duplicate_key_warnings=${dupWarningsTotal} exceeds threshold ${DUP_WARNING_THRESHOLD}`);
        }

        const readiness = blockers.length > 0 ? 'blocked' : 'ready';

        return {
          source,
          readiness,
          blockers,
          total_runs: total,
          success_count: successCount,
          failed_count: failedRuns.length,
          skipped_count: skippedRuns.length,
          success_rate: total > 0 ? Math.round(successRate * 10000) / 10000 : null,
          days_observed: daysObserved,
          latest_success: latestSuccess,
          latest_failure: latestFailure,
          stale,
          stale_reason: staleReason,
          avg_records_written: avgRecordsWritten != null ? Math.round(avgRecordsWritten * 10) / 10 : null,
          min_records_written: minRecordsWritten,
          max_records_written: maxRecordsWritten,
          duplicate_key_warnings_total: dupWarningsTotal,
          required_field_missing_count_total: missingFieldsTotal,
        };
      }),
    );

    // Global gate
    const bySource = Object.fromEntries(sourceResults.map((r) => [r.source, r]));
    const anyBlocked = REQUIRED_SOURCES.some((s) => bySource[s]?.readiness === 'blocked');
    const allReady = REQUIRED_SOURCES.every((s) => bySource[s]?.readiness === 'ready');
    const overall = anyBlocked ? 'blocked' : allReady ? 'ready_to_promote' : 'watch';

    const blockedSources = REQUIRED_SOURCES.filter((s) => bySource[s]?.readiness === 'blocked');
    const watchSources = REQUIRED_SOURCES.filter((s) => bySource[s]?.readiness === 'watch');

    let recommendation;
    if (overall === 'ready_to_promote') {
      recommendation = 'All required sources are healthy and up to date. Data can be used in production dashboards.';
    } else if (overall === 'blocked') {
      recommendation = `Sources need attention: ${blockedSources.join(', ')}. Resolve blockers and observe for at least 3 more days.`;
    } else {
      recommendation = `Sources need more observation time: ${watchSources.join(', ')}. Continue monitoring scheduled runs.`;
    }

    return res.json({
      ok: true,
      evaluated_at: new Date().toISOString(),
      observation_days: days,
      since: sinceIso,
      global: {
        overall,
        required_sources_ready: allReady,
        blocked_sources: blockedSources,
        watch_sources: watchSources,
        recommendation,
      },
      sources: sourceResults,
    });
  } catch (err) {
    console.error('[adminIngestion] /readiness error:', err.message);
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
});

// ── POST /api/admin/ingestion/schedules/:source/pause ────────────────────────

r.post('/schedules/:source/pause', async (req, res) => {
  try {
    const { source } = req.params;
    validateSource(source);
    const db = getDb();
    await db.collection(ADMIN_CONFIG_COLLECTION).updateOne(
      { type: 'ingestion_source', source },
      {
        $set: {
          'schedule.paused': true,
          updated_at: new Date().toISOString(),
          updated_by: req.user?.uid || req.user?.email || 'admin',
        },
      },
      { upsert: true },
    );
    return res.json({ ok: true, source, paused: true });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
});

// ── POST /api/admin/ingestion/schedules/:source/resume ───────────────────────

r.post('/schedules/:source/resume', async (req, res) => {
  try {
    const { source } = req.params;
    validateSource(source);
    const db = getDb();
    await db.collection(ADMIN_CONFIG_COLLECTION).updateOne(
      { type: 'ingestion_source', source },
      {
        $set: {
          'schedule.paused': false,
          updated_at: new Date().toISOString(),
          updated_by: req.user?.uid || req.user?.email || 'admin',
        },
      },
      { upsert: true },
    );
    return res.json({ ok: true, source, paused: false });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
});

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Flatten a nested patch object to MongoDB dot-notation keys.
 * e.g. { schedule: { interval_minutes: 15 } } → { 'schedule.interval_minutes': 15 }
 */
function flattenPatch(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenPatch(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

// ── GET /api/admin/ingestion/jobs ────────────────────────────────────────────
r.get('/jobs', (req, res) => {
  const jobs = Array.from(_jobStore.values())
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 20);
  return res.json({ ok: true, jobs });
});

// ── GET /api/admin/ingestion/jobs/:jobId ─────────────────────────────────────
r.get('/jobs/:jobId', (req, res) => {
  const job = _jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND', message: `Job ${req.params.jobId} not found` });
  return res.json({ ok: true, job });
});

// ── POST /api/admin/ingestion/jobs/:jobId/cancel ──────────────────────────────
r.post('/jobs/:jobId/cancel', (req, res) => {
  const job = _jobStore.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });
  if (!['queued', 'running'].includes(job.status)) {
    return res.json({ ok: true, message: `Job already ${job.status}`, job });
  }
  const child = _jobProcesses.get(req.params.jobId);
  if (child) { child.kill('SIGTERM'); _jobProcesses.delete(req.params.jobId); }
  _updateJob(req.params.jobId, { status: 'cancelled', completed_at: new Date().toISOString() });
  return res.json({ ok: true, job: _jobStore.get(req.params.jobId) });
});

// ── GET /api/admin/ingestion/enrichment/harris-sheriff/:spn ───────────────────
// Returns the stored enrichment document for a given SPN (if any).

r.get('/enrichment/harris-sheriff/:spn', async (req, res) => {
  try {
    const db = getDb();
    const spn = String(req.params.spn || '').trim();
    if (!spn) {
      return res.status(400).json({ ok: false, error: 'MISSING_SPN', message: 'spn is required' });
    }
    const doc = await db.collection('harris_sheriff_enrichments').findOne(
      { spn },
      { projection: { _id: 0 } },
    );
    return res.json({ ok: true, enrichment: doc ?? null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: err.message });
  }
});

// ── POST /api/admin/ingestion/enrich/harris-sheriff ───────────────────────────
// Runs a single-SPN enrichment synchronously. Accepts { spn, dry_run }.
// When dry_run=false and the person is NOT IN JAIL, v2_harris_reports records
// are automatically flagged as no_longer_prospect=true.

r.post('/enrich/harris-sheriff', async (req, res) => {
  const { spn: spnParam = '', dry_run: dryRunParam = true } = req.body || {};

  const spn = String(spnParam || '').trim().replace(/\D/g, '').padStart(8, '0');
  if (!spn || spn === '00000000') {
    return res.status(400).json({ ok: false, error: 'MISSING_SPN', message: 'spn is required' });
  }

  const dryRun = dryRunParam !== false && dryRunParam !== 'false';
  const allowNonDryRun = String(process.env.ALLOW_ADMIN_NON_DRY_RUN || 'false').toLowerCase() === 'true';
  if (!dryRun && !allowNonDryRun) {
    return res.status(403).json({
      ok: false,
      error: 'NON_DRY_RUN_BLOCKED',
      message: 'Non-dry-run is disabled. Set ALLOW_ADMIN_NON_DRY_RUN=true to enable writes from the admin UI.',
    });
  }

  try {
    const { existsSync } = await import('node:fs');
    if (!existsSync(path.join(PIPELINE_ROOT, 'scripts', 'run_ingestion_v2.py'))) {
      return res.status(503).json({ ok: false, error: 'PIPELINE_NOT_FOUND' });
    }
  } catch (err) {
    return res.status(503).json({ ok: false, error: 'PIPELINE_CHECK_FAILED', message: err.message });
  }

  const createdBy = req.user?.uid || req.user?.email || 'admin';
  const pyArgs = [
    path.join(PIPELINE_ROOT, 'scripts', 'run_ingestion_v2.py'),
    '--source', 'harris_sheriff_enrichment',
    '--spn', spn,
    '--limit', '1',
    '--trigger', 'manual',
    '--created-by', createdBy,
    dryRun ? '--dry-run' : '--no-dry-run',
  ];
  const childEnv = {
    ...process.env,
    PYTHONPATH: PIPELINE_ROOT,
    USE_V2_INGESTION: dryRun ? 'false' : 'true',
    DRY_RUN: dryRun ? 'true' : 'false',
  };
  const redactedCmd = `python3 scripts/run_ingestion_v2.py --source harris_sheriff_enrichment --spn ${spn}${dryRun ? ' --dry-run' : ' --no-dry-run'}`;

  let stdout = '';
  let stderr = '';
  let exitCode = null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('python3', pyArgs, {
        cwd: PIPELINE_ROOT,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (c) => { stdout += c.toString(); if (stdout.length > OUTPUT_TAIL_CHARS * 2) stdout = stdout.slice(-OUTPUT_TAIL_CHARS * 2); });
      child.stderr.on('data', (c) => { stderr += c.toString(); if (stderr.length > OUTPUT_TAIL_CHARS * 2) stderr = stderr.slice(-OUTPUT_TAIL_CHARS * 2); });
      child.on('close', (code) => { exitCode = code; resolve(); });
      child.on('error', reject);
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Timed out after 60 seconds')); }, 60_000);
      child.on('close', () => clearTimeout(timer));
    });
  } catch (spawnErr) {
    return res.status(500).json({ ok: false, error: 'SPAWN_FAILED', message: spawnErr.message, command: redactedCmd });
  }

  const structured = parseStructuredResult(stdout, stdout);

  return res.json({
    ok: exitCode === 0,
    spn,
    dry_run: dryRun,
    custody_status: structured?.custody_status ?? null,
    full_name: structured?.full_name ?? null,
    dob: structured?.dob ?? null,
    age: structured?.age ?? null,
    sex: structured?.sex ?? null,
    race: structured?.race ?? null,
    released: structured?.released ?? false,
    matched: (structured?.matched ?? 0) > 0,
    exit_code: exitCode,
    command: redactedCmd,
    stdout_tail: tailOutput(redactSecrets(stdout)),
    stderr_tail: tailOutput(redactSecrets(stderr)),
  });
});

export default r;
