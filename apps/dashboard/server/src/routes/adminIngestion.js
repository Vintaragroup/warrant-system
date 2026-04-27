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
import path from 'node:path';
import mongoose from 'mongoose';

const r = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_SOURCES = [
  'galveston',
  'harris_reports',
  'fortbend_lookup',
  'jefferson_lookup',
  'brazoria_lookup',
];

// Per-source maximum limit for manual runs
const SOURCE_MAX_LIMITS = {
  galveston: 500,
  harris_reports: 4,
  fortbend_lookup: 100,
  jefferson_lookup: 100,
  brazoria_lookup: 100,
};

// Staging collection names per source (for status display)
const SOURCE_STAGING_COLLECTIONS = {
  galveston: 'v2_galveston_events',
  harris_reports: 'v2_harris_reports',
  fortbend_lookup: 'v2_lookup_results',
  jefferson_lookup: 'v2_lookup_results',
  brazoria_lookup: 'v2_lookup_results',
};

const SOURCE_LIVE_COLLECTIONS = {
  galveston: 'simple_galveston',
  harris_reports: 'simple_harris',
  fortbend_lookup: 'simple_fortbend',
  jefferson_lookup: 'simple_jefferson',
  brazoria_lookup: 'simple_brazoria',
};

const ADMIN_CONFIG_COLLECTION = 'admin_config';
const INGESTION_RUNS_COLLECTION = 'ingestion_runs';

// Max tail bytes stored/returned per run output
const OUTPUT_TAIL_CHARS = 4000;

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

    const query = {
      status: { $in: ['failed', 'skipped'] },
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
    force = false,
  } = req.body || {};

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

  // Lookup sources require last_name
  const isLookup = source.endsWith('_lookup');
  if (isLookup && !lastName) {
    return res.status(400).json({
      ok: false,
      error: 'MISSING_LAST_NAME',
      message: `last_name is required for lookup sources (source=${source})`,
    });
  }

  const limit = clampLimit(source, limitParam);
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
    '--limit', String(limit),
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

  // Redacted command for logging (never include secrets)
  const redactedCmd = `python3 scripts/run_ingestion_v2.py --source ${source} --limit ${limit} --trigger manual${dryRun ? ' --dry-run' : ' --no-dry-run'}`;

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

      // Hard timeout: 5 minutes max for a manual run
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Run timed out after 5 minutes'));
      }, 5 * 60 * 1000);

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

  return res.json({
    ok: exitCode === 0,
    source,
    dry_run: dryRun,
    limit,
    status,
    exit_code: exitCode,
    command: redactedCmd,
    stdout_tail: tailOutput(redactSecrets(stdout)),
    stderr_tail: tailOutput(redactSecrets(stderr)),
  });
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

export default r;
