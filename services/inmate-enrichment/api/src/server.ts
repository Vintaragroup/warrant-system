import { Router } from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import { config, logger, getIngestionTimestamp, isWithinWindow, normalizeMatch } from '@inmate/shared';
import { InmateModel, EnrichmentJobModel, RawProviderPayloadModel, RelatedPartyModel } from '@inmate/shared';
import { buildPartyId } from '@inmate/shared';
import axios from 'axios';

// Shared default for high-quality match threshold (0-1)
const DEFAULT_MATCH_MIN = Number(process.env.HIGH_QUALITY_MATCH ?? '0.75');
// Cooldown window (minutes) for targeted related-party pulls
const PARTY_PULL_COOLDOWN_MINUTES = Math.max(0, Number(process.env.PARTY_PULL_COOLDOWN_MINUTES ?? '30'));

async function whitepagesLookupLocal({ phones }: { phones: string[] }) {
  if (!((config as any).providerWhitepagesEnabled && config.whitepagesApiKey)) {
    return { data: phones.map((p) => ({ phone: p, ok: false, reason: 'WP_DISABLED' })) } as any;
  }
  const url = 'https://proapi.whitepages.com/3.5/phone';
  const out: any[] = [];
  for (const p of phones) {
    try {
      const resp = await axios.get(url, { params: { api_key: config.whitepagesApiKey!, phone: p }, timeout: 8000 });
      out.push(resp.data);
    } catch (e: any) {
      out.push({ phone: p, ok: false, error: String(e?.response?.status || e?.message || e) });
    }
  }
  return { data: out } as any;
}
import { setupChangeStreamWatcher } from './watcher';
import { setupSweep } from './sweep';

export async function createServer() {
  const router = Router();
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue('enrichment', { connection });

  // POST /api/enrichment/run
  router.post('/enrichment/run', async (req: any, res: any) => {
    const { subjectIds, mode = 'standard', force = false, jobSuffix, windowHoursOverride, minBondOverride } = req.body as { subjectIds: string[]; mode?: 'standard' | 'deep' | 'dob-only'; force?: boolean; jobSuffix?: string; windowHoursOverride?: number; minBondOverride?: number };
    if (!Array.isArray(subjectIds) || subjectIds.length === 0) {
      return res.status(400).json({ error: 'subjectIds required' });
    }
    const jobs: string[] = [];
    for (const subjectId of subjectIds) {
      const doc = await InmateModel.findOne({ $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] }).lean();
      if (!doc) continue;
      const ts = getIngestionTimestamp(doc as any);
      const bondAmount = (doc as any)?.bond_amount || (doc as any)?.bond || 0;
      if (!force) {
        if (!ts || !isWithinWindow(ts, config.enrichmentWindowHours)) {
          continue;
        }
        if (typeof bondAmount === 'number' && bondAmount < config.bondThreshold) {
          continue;
        }
      }
      // Idempotency and active job checks (skip if force or jobSuffix provided)
      if (!force && !jobSuffix) {
        const since = new Date(Date.now() - config.idempotencyWindowSeconds * 1000);
        const existing = await EnrichmentJobModel.findOne({ subjectId, status: 'SUCCEEDED', updatedAt: { $gte: since } });
        if (existing) {
          continue;
        }
        const active = await EnrichmentJobModel.findOne({ subjectId, status: { $in: ['NEW', 'READY', 'RUNNING'] } });
        if (active) {
          continue;
        }
      }
      const jobIdStr = `${subjectId}_${mode}${jobSuffix ? `_${jobSuffix}` : ''}`;
  const runOpts: any = {};
  if (typeof windowHoursOverride === 'number' && isFinite(windowHoursOverride)) runOpts.windowHoursOverride = Math.max(1, Math.min(168, windowHoursOverride));
  if (typeof minBondOverride === 'number' && isFinite(minBondOverride)) runOpts.minBondOverride = Math.max(0, minBondOverride);
  const job = await queue.add('enrich', { subjectId, mode, runOpts }, { removeOnComplete: true, removeOnFail: false, jobId: jobIdStr });
      await EnrichmentJobModel.updateOne(
        { jobId: job.id },
        {
          $setOnInsert: {
            jobId: job.id,
            subjectId,
            status: 'READY',
            steps: [],
            progress: 0,
            logs: [],
            errors: [],
            idempotencyKey: `${subjectId}_v1`,
          },
        },
        { upsert: true }
      );
      jobs.push(String(job.id));
    }
    res.json({ jobIds: jobs });
  });

  // GET /api/enrichment/status
  router.get('/enrichment/status', async (req: any, res: any) => {
    const jobId = String(req.query.jobId || '');
    if (!jobId) return res.status(400).json({ error: 'jobId required' });
    const job = await EnrichmentJobModel.findOne({ jobId });
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json({
      status: job.status,
      steps: job.steps,
      progress: job.progress,
      logs: job.logs?.slice(-50) || [],
      errors: job.errors || [],
      startedAt: job.createdAt,
      finishedAt: job.updatedAt,
      subjectId: job.subjectId,
    });
  });

  // POST /api/enrichment/cancel
  router.post('/enrichment/cancel', async (req: any, res: any) => {
    const { jobId } = req.body as { jobId: string };
    if (!jobId) return res.status(400).json({ error: 'jobId required' });
    const job = await EnrichmentJobModel.findOne({ jobId });
    if (!job) return res.status(404).json({ error: 'not found' });
    if (['PENDING', 'READY', 'RUNNING', 'NEW'].includes(job.status)) {
      job.status = 'CANCELLED' as any;
      await job.save();
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'cannot cancel' });
  });

  // Provider connectivity test endpoints
  router.get('/providers/pdl/test', async (_req: any, res: any) => {
    try {
      if (!config.pdlApiKey || !(config as any).providerPdlEnabled) return res.status(400).json({ ok: false, reason: 'DISABLED_OR_MISSING_KEY' });
      // Minimal request that should auth but not consume heavy cost
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  // Debug: surface non-sensitive details about the configured PDL key
  router.get('/providers/pdl/debug', async (_req: any, res: any) => {
    try {
      const key = config.pdlApiKey || '';
      const enabled = !!((config as any).providerPdlEnabled && key);
      const keyLen = key.length;
      const suffix = keyLen >= 4 ? key.slice(-4) : key;
      const prefix = keyLen >= 4 ? key.slice(0, 4) : key;
      res.json({ ok: true, enabled, keyPresent: !!keyLen, keyLen, preview: { prefix, suffix } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  router.get('/providers/whitepages/test', async (_req: any, res: any) => {
    try {
      if (!config.whitepagesApiKey || !(config as any).providerWhitepagesEnabled) return res.status(400).json({ ok: false, reason: 'DISABLED_OR_MISSING_KEY' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  // Last stored Whitepages payload (preview) optionally filtered by subjectId
  router.get('/providers/whitepages/last', async (req: any, res: any) => {
    try {
      const step = String(req.query.step || '').trim();
      const q: any = { provider: 'whitepages' };
      const subjectId = String(req.query.subjectId || '').trim();
      if (subjectId) q.subjectId = subjectId;
      if (step) q.step = step;
      const doc: any = await RawProviderPayloadModel.findOne(q).sort({ createdAt: -1 }).lean();
      if (!doc) return res.status(404).json({ ok: false, error: 'NO_PAYLOAD' });
      const payload = (doc as any)?.payload || {};
      res.json({ ok: true, when: (doc as any)?.createdAt || null, step: (doc as any)?.step || null, keys: Object.keys(payload), preview: JSON.stringify(payload).slice(0, 4000) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  // Full Whitepages payload for a subject (most recent)
  router.get('/providers/whitepages/raw', async (req: any, res: any) => {
    try {
      const subjectId = String(req.query.subjectId || '').trim();
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      const doc: any = await RawProviderPayloadModel.findOne({ provider: 'whitepages', subjectId }).sort({ createdAt: -1 }).lean();
      if (!doc) return res.status(404).json({ ok: false, error: 'NO_PAYLOAD' });
      const payload = (doc as any)?.payload || {};
      res.json({ ok: true, when: (doc as any)?.createdAt || null, step: (doc as any)?.step || null, payload });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  router.get('/providers/pipl/test', async (_req: any, res: any) => {
    try {
      if (!(config as any).piplApiKey || !(config as any).providerPiplEnabled) return res.status(400).json({ ok: false, reason: 'DISABLED_OR_MISSING_KEY' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  router.get('/providers/pipl/last', async (req: any, res: any) => {
    try {
      const step = String(req.query.step || '').trim();
      const q: any = { provider: 'pipl' };
      const subjectId = String(req.query.subjectId || '').trim();
      if (subjectId) q.subjectId = subjectId;
      if (step) q.step = step;
  const doc: any = await RawProviderPayloadModel.findOne(q).sort({ createdAt: -1 }).lean();
  if (!doc) return res.status(404).json({ ok: false, error: 'NO_PAYLOAD' });
  const payload = (doc as any)?.payload || {};
  // Avoid huge payloads in response
  res.json({ ok: true, when: (doc as any)?.createdAt || null, step: (doc as any)?.step || null, keys: Object.keys(payload), preview: JSON.stringify(payload).slice(0, 4000) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  // Raw Pipl payload (full) for a specific subject (for visualization/review)
  router.get('/providers/pipl/raw', async (req: any, res: any) => {
    try {
      const subjectId = String(req.query.subjectId || '').trim();
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      const doc: any = await RawProviderPayloadModel.findOne({ provider: 'pipl', subjectId }).sort({ createdAt: -1 }).lean();
      if (!doc) return res.status(404).json({ ok: false, error: 'NO_PAYLOAD' });
      const payload = (doc as any)?.payload || {};
      const resp = (payload && payload.response) ? payload.response : payload;
      res.json({ ok: true, when: (doc as any)?.createdAt || null, step: (doc as any)?.step || null, response: resp, request: (payload && payload.request) || null });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Normalized Pipl matches for a subject (for UI tables)
  router.get('/enrichment/pipl_matches', async (req: any, res: any) => {
    try {
      const subjectId = String(req.query.subjectId || '').trim();
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      const doc: any = await RawProviderPayloadModel.findOne({ provider: 'pipl', subjectId }).sort({ createdAt: -1 }).lean();
      if (!doc) return res.status(404).json({ ok: false, error: 'NO_PAYLOAD' });
      const payload = (doc as any)?.payload || {};
      const resp = (payload && payload.response) ? payload.response : payload;
      const persons: any[] = Array.isArray(resp?.possible_persons) ? resp.possible_persons : (resp?.person ? [resp.person] : []);
      const rows = persons.map((p: any, idx: number) => {
        const name = (Array.isArray(p?.names) && p.names[0]) ? (p.names[0].display || [p.names[0].first, p.names[0].last].filter(Boolean).join(' ')) : null;
        const m = typeof p?.['@match'] === 'number' ? p['@match'] : (typeof resp?.['@match'] === 'number' ? resp['@match'] : null);
        const phones = Array.isArray(p?.phones) ? p.phones.map((pp: any) => pp?.display_international || pp?.number || String(pp)).filter(Boolean) : [];
        const emails = Array.isArray(p?.emails) ? p.emails.map((e: any) => e?.address || String(e)).filter(Boolean) : [];
        const addresses = Array.isArray(p?.addresses)
          ? p.addresses.map((a: any) => a?.display || [a?.street, a?.city, a?.state, a?.postal_code || a?.zip, a?.country].filter(Boolean).join(', ')).filter(Boolean)
          : [];
        const usernames = Array.isArray(p?.usernames) ? p.usernames : [];
        return { idx, name, match: m, phones, emails, addresses, usernames };
      });
      res.json({ ok: true, count: rows.length, rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  router.get('/providers/openai/test', async (_req: any, res: any) => {
    try {
      if (!config.openaiApiKey || !(config as any).providerOpenaiEnabled) return res.status(400).json({ ok: false, reason: 'DISABLED_OR_MISSING_KEY' });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/providers/pipl/ad_hoc { first, last, city?, state?, country?, dobStart?, dobEnd? }
  router.post('/providers/pipl/ad_hoc', async (req: any, res: any) => {
    try {
      if (!(config as any).piplApiKey || !(config as any).providerPiplEnabled) return res.status(400).json({ ok: false, error: 'PIPL_DISABLED_OR_MISSING_KEY' });
      const { first, last, city, state, country = 'US', dobStart, dobEnd } = req.body || {};
      if (!first || !last) return res.status(400).json({ ok: false, error: 'first and last required' });
      const person: any = { names: [{ first: String(first), last: String(last) }] };
      if (city || state || country) {
        const addr: any = { country: country || 'US' };
        if (city) addr.city = String(city);
        if (state) addr.state = String(state);
        person.addresses = [addr];
      }
      if (dobStart || dobEnd) {
        person.dob = {} as any;
        if (dobStart) (person.dob as any).date_range = Object.assign((person.dob as any).date_range || {}, { start: String(dobStart) });
        if (dobEnd) (person.dob as any).date_range = Object.assign((person.dob as any).date_range || {}, { end: String(dobEnd) });
      }
      const bodyReq = { key: (config as any).piplApiKey, person };
      const r = await fetch('https://api.pipl.com/search/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyReq) } as any);
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ ok: false, error: 'PIPL_HTTP_'+r.status, body: text.slice(0, 2000) });
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = {}; }
      const summary = {
        http_status_code: data?.['@http_status_code'] || r.status,
        visible_sources: data?.['@visible_sources'] || 0,
        available_sources: data?.['@available_sources'] || 0,
        persons_count: data?.['@persons_count'] || 0,
        search_id: data?.['@search_id'] || null,
        available_data: data?.available_data?.premium || null,
      };
  try { await RawProviderPayloadModel.create({ provider: 'pipl', step: 'pipl_ad_hoc', payload: { request: { person }, response: data }, ttlExpiresAt: new Date(Date.now() + (config as any).rawPayloadTtlHours * 3600 * 1000) }); } catch {}
      res.json({ ok: true, request: { person }, summary });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/maintenance/backfill_location { windowHours?: number, limit?: number }
  // Derive and persist city/state/country from existing address fields for recent inmates
  router.post('/maintenance/backfill_location', async (req: any, res: any) => {
    try {
      const windowHours = Math.max(1, Math.min(720, Number(req.body.windowHours || 168)));
      const limit = Math.max(1, Math.min(5000, Number(req.body.limit || 500)));
      const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
      function parseTs(v: any): Date | null {
        if (v == null) return null;
        if (v instanceof Date && !isNaN(v.getTime())) return v;
        if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
        if (typeof v === 'string') { const s=v.trim(); if(!s) return null; const d0=new Date(s); if(!isNaN(d0.getTime())) return d0; if (/^\d{10,13}$/.test(s)) { const n=Number(s); return new Date(s.length===13?n:n*1000);} }
        return null;
      }
      function bestBooking(doc: any): Date | null { for (const f of bookingFields) { if (Object.prototype.hasOwnProperty.call(doc,f)) { const d=parseTs((doc as any)[f]); if (d && !isNaN(d.getTime())) return d; } } return null; }
      const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
      const projection = { spn: 1, subject_id: 1, subjectId: 1, address: 1, addr: 1, city: 1, state: 1, country: 1, zip: 1, booking_datetime: 1, booking_at: 1, booking_time: 1, booking_date: 1 };
      const docs = await InmateModel.find({}, projection).sort({ _id: -1 }).limit(50000).lean();
      let updates = 0; const touched: string[] = [];
      for (const d of docs) {
        const bAt = bestBooking(d); if (!bAt || bAt < cutoff) continue;
        if (updates >= limit) break;
        const hasCity = !!(d.city && String(d.city).trim());
        const hasState = !!(d.state && String(d.state).trim());
        const hasCountry = !!(d.country && String(d.country).trim());
        if (hasCity && hasState && hasCountry) continue;
        const addr = (d as any).address || (d as any).addr || null;
        const baseCity = (d as any).city || undefined; const baseState = (d as any).state || undefined; const baseZip = (d as any).zip || undefined;
        const parseAddrObj = (a: any) => {
          const out: any = { city: baseCity, state: baseState, zip: baseZip };
          if (!a) return out;
          if (typeof a === 'string') {
            const lines = a.split(/\n|\r|;/).map((s) => s.trim()).filter(Boolean);
            const last = lines[lines.length - 1] || '';
            const parts = last.split(',').map((s) => s.trim()).filter(Boolean);
            const zipMatch = last.match(/\b\d{5}(?:-\d{4})?\b/);
            if (!out.city && parts[0]) out.city = parts[0];
            if (!out.state && parts[1]) out.state = parts[1];
            if (!out.zip && zipMatch) out.zip = zipMatch[0];
            return out;
          }
          if (typeof a === 'object') {
            if (!out.city && a.city) out.city = String(a.city).trim();
            if (!out.state && a.state) out.state = String(a.state).trim();
            if (!out.zip && (a.zip || a.postal_code)) out.zip = String(a.zip || a.postal_code).trim();
            return out;
          }
          return out;
        };
        const fromAddr = parseAddrObj(addr);
        const patch: any = {};
        if (!hasCity && fromAddr.city) patch.city = fromAddr.city;
        if (!hasState && fromAddr.state) patch.state = fromAddr.state;
        if (!hasCountry) patch.country = 'US';
        if (Object.keys(patch).length) {
          const subjectId = (d as any).spn || (d as any).subject_id || (d as any).subjectId;
          await InmateModel.updateOne({ $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] }, { $set: patch });
          updates++;
          touched.push(String(subjectId));
        }
      }
      res.json({ ok: true, windowHours, limit, updated: updates, sample: touched.slice(0, 10) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  if (config.autoEnrichEnabled) {
    setupChangeStreamWatcher(queue).catch((e) => logger.error('change stream error', { e: String(e) }));
    setupSweep(queue).catch((e) => logger.error('sweep error', { e: String(e) }));
  }

  // GET /api/enrichment/coverage72h -> { total, haveDob, notInJail, unresolved, pct }
  router.get('/enrichment/coverage72h', async (_req: any, res: any) => {
    try {
      const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
      function parseTs(v: any): Date | null {
        if (v == null) return null;
        if (v instanceof Date && !isNaN(v.getTime())) return v;
        if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
        if (typeof v === 'string') {
          const s = v.trim();
          if (!s) return null;
          const d0 = new Date(s);
          if (!isNaN(d0.getTime())) return d0;
          if (/^\d{10,13}$/.test(s)) {
            const n = Number(s);
            return new Date(s.length === 13 ? n : n * 1000);
          }
        }
        return null;
      }
      function bestBooking(doc: any): Date | null {
        for (const f of bookingFields) {
          if (Object.prototype.hasOwnProperty.call(doc, f)) {
            const d = parseTs((doc as any)[f]);
            if (d && !isNaN(d.getTime())) return d;
          }
        }
        return null;
      }
  const cutoff = new Date(Date.now() - 72 * 3600 * 1000);
      const docs = await InmateModel.find({}, { dob: 1, hcso_status: 1, spn: 1, subject_id: 1, subjectId: 1, booking_datetime: 1, booking_at: 1, booking_time: 1, booking_date: 1 })
        .sort({ _id: -1 })
        .limit(30000)
        .lean();
      const recent = docs.filter((d: any) => {
        const b = bestBooking(d);
        return b && b >= cutoff;
      });
      let haveDob = 0, notInJail = 0, unresolved = 0, notBondable = 0, moreCharges = 0;
      for (const d of recent) {
        const dobOk = d.dob != null && String(d.dob).trim() !== '';
        const notIn = !!(d.hcso_status && d.hcso_status.notInJail);
        if (d.hcso_status?.notBondable) notBondable++;
        if (d.hcso_status?.moreChargesPossible) moreCharges++;
        if (dobOk) haveDob++; else if (notIn) notInJail++; else unresolved++;
      }
      const total = recent.length;
      const pct = total ? Math.round(((haveDob + notInJail) / total) * 1000) / 10 : 0;
      res.json({ total, haveDob, notInJail, unresolved, pct, notBondable, moreCharges });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/queue_stats?windowMinutes=60
  router.get('/enrichment/queue_stats', async (req: any, res: any) => {
    try {
      const windowMinutes = Math.max(1, Math.min(1440, Number(req.query.windowMinutes || 60)));
      const counts = await queue.getJobCounts('waiting','active','completed','failed','delayed','paused');
      // BullMQ doesn't expose throughput natively; we can approximate via recent completed jobs
      const since = new Date(Date.now() - windowMinutes * 60 * 1000);
      const recent = await EnrichmentJobModel.find({ updatedAt: { $gte: since }, status: { $in: ['SUCCEEDED','PARTIAL','FAILED'] } }, { updatedAt: 1 }).countDocuments();
      res.json({ windowMinutes, counts, approxThroughputPerMin: Math.round((recent / windowMinutes) * 10) / 10 });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/prospects?minBond=500&limit=50
  // Prospects: bond > minBond, dob present, not not-in-jail, and bondExceptionText not containing 'DENIED'
  router.get('/enrichment/prospects', async (req: any, res: any) => {
    try {
      const minBond = Number(req.query.minBond || 500);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
      const includeNotBondable = String(req.query.includeNotBondable || 'false').toLowerCase() === 'true';
      // helpers for booking date extraction
      const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
      function parseTs(v: any): Date | null {
        if (v == null) return null;
        if (v instanceof Date && !isNaN(v.getTime())) return v;
        if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
        if (typeof v === 'string') {
          const s = v.trim(); if (!s) return null; const d0 = new Date(s); if (!isNaN(d0.getTime())) return d0;
          if (/^\d{10,13}$/.test(s)) { const n = Number(s); return new Date(s.length === 13 ? n : n * 1000); }
        }
        return null;
      }
      function bestBooking(doc: any): Date | null {
        for (const f of bookingFields) { if (Object.prototype.hasOwnProperty.call(doc, f)) { const d = parseTs((doc as any)[f]); if (d && !isNaN(d.getTime())) return d; } }
        return null;
      }
      const filter: any = {
        dob: { $ne: null },
        $expr: { $gt: [ { $ifNull: ['$bond_amount', { $ifNull: ['$bond', 0] }] }, minBond ] },
        'hcso_status.notInJail': { $ne: true },
        $or: [ { 'hcso_status.bondExceptionText': { $exists: false } }, { 'hcso_status.bondExceptionText': { $not: /denied/i } } ],
      };
      // We'll implement strict notBondable exclusion after fetch so we can compute confidence using text
  const projection = { spn: 1, subject_id: 1, subjectId: 1, dob: 1, bond: 1, bond_amount: 1, hcso_status: 1, booking_datetime: 1, booking_at: 1, booking_time: 1, booking_date: 1 };
      const total = await InmateModel.countDocuments(filter);
      const docs = await InmateModel.find(filter, projection).sort({ bond_amount: -1, bond: -1, _id: -1 }).limit(500).lean();
      const strongRe = /(\bno\s*bond\b|\bnon[- ]?bondable\b|\bbond\s*denied\b|\bdenied\s*bond\b)/i;
      // Apply strict notBondable filter locally
      const filteredDocs = docs.filter((d: any) => {
        const nb = !!d?.hcso_status?.notBondable;
        const txt = String(d?.hcso_status?.bondExceptionText || '');
        const strong = nb && strongRe.test(txt);
        return includeNotBondable ? true : !strong;
      }).slice(0, limit);
      const rows = filteredDocs.map((d: any) => {
        const subjectId = d.spn || d.subject_id || d.subjectId;
        const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : null);
        const bAt = bestBooking(d);
        const txt = String(d?.hcso_status?.bondExceptionText || '');
        const strong = !!d?.hcso_status?.notBondable && strongRe.test(txt);
        return { subjectId: String(subjectId), bond: bondVal, dob: d.dob || null, bookingDate: bAt ? bAt.toISOString() : null, notInJail: !!d?.hcso_status?.notInJail, notBondable: !!d?.hcso_status?.notBondable, notBondableStrict: strong, moreChargesPossible: !!d?.hcso_status?.moreChargesPossible, bondExceptionText: d?.hcso_status?.bondExceptionText || null };
      });
      const excludedStrictNotBondable = docs.length - filteredDocs.length;
      res.json({ total, count: rows.length, minBond, includeNotBondable, excludedStrictNotBondable, rows });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/prospects_window?windowHours=48&minBond=500&limit=0
  // Counts prospects within booking window: bond > minBond, dob present, not not-in-jail, and bondExceptionText not containing 'DENIED'
  router.get('/enrichment/prospects_window', async (req: any, res: any) => {
    try {
      const windowHours = Math.max(1, Math.min(168, Number(req.query.windowHours || 48)));
      const minBond = Number(req.query.minBond || 500);
      const limit = Math.min(200, Math.max(0, Number(req.query.limit || 0)));
      const includeNotBondable = String(req.query.includeNotBondable || 'false').toLowerCase() === 'true';
      const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
      function parseTs(v: any): Date | null {
        if (v == null) return null;
        if (v instanceof Date && !isNaN(v.getTime())) return v;
        if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
        if (typeof v === 'string') {
          const s = v.trim(); if (!s) return null; const d0 = new Date(s); if (!isNaN(d0.getTime())) return d0;
          if (/^\d{10,13}$/.test(s)) { const n = Number(s); return new Date(s.length === 13 ? n : n * 1000); }
        }
        return null;
      }
      function bestBooking(doc: any): Date | null {
        for (const f of bookingFields) { if (Object.prototype.hasOwnProperty.call(doc, f)) { const d = parseTs((doc as any)[f]); if (d && !isNaN(d.getTime())) return d; } }
        return null;
      }
      const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
      // Pull a sizable recent set and filter in memory, similar to coverage endpoints
  const projection = { spn: 1, subject_id: 1, subjectId: 1, dob: 1, bond: 1, bond_amount: 1, hcso_status: 1, booking_datetime: 1, booking_at: 1, booking_time: 1, booking_date: 1, address: 1, addr: 1, city: 1, state: 1, zip: 1 };
      const docs = await InmateModel.find({}, projection).sort({ _id: -1 }).limit(50000).lean();
      const filteredAll = docs.filter((d: any) => {
        const bAt = bestBooking(d); if (!bAt || bAt < cutoff) return false;
        const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : 0);
        const hasDob = d.dob != null && String(d.dob).trim() !== '';
        const notInJail = !!d?.hcso_status?.notInJail;
        const denied = !!(d?.hcso_status?.bondExceptionText && /denied/i.test(String(d.hcso_status.bondExceptionText)));
        return hasDob && !notInJail && !denied && bondVal > minBond;
      });
      const strongRe = /(\bno\s*bond\b|\bnon[- ]?bondable\b|\bbond\s*denied\b|\bdenied\s*bond\b)/i;
      const strongNotBondable = (d:any) => !!d?.hcso_status?.notBondable && strongRe.test(String(d?.hcso_status?.bondExceptionText||''));
      const excludedStrictNotBondable = filteredAll.filter((d:any) => strongNotBondable(d)).length;
      let filtered = filteredAll.filter((d:any) => includeNotBondable ? true : !strongNotBondable(d));
      // Sort by most recent booking date desc
      filtered = filtered.sort((a:any,b:any) => {
        const aB = bestBooking(a)?.getTime() || 0; const bB = bestBooking(b)?.getTime() || 0; return bB - aB;
      });
      const moreChargesCount = filtered.filter((d:any) => !!d?.hcso_status?.moreChargesPossible).length;
      const total = filtered.length;
      let rows: any[] = [];
      if (limit > 0) {
        const limited = filtered.slice(0, limit);
        const ids = limited.map((d: any) => String(d.spn || d.subject_id || d.subjectId)).filter(Boolean);
        // Batch aggregate enrichment job counts per subject
        const jobCounts = await EnrichmentJobModel.aggregate([
          { $match: { subjectId: { $in: ids } } },
          { $group: { _id: '$subjectId', count: { $sum: 1 } } },
        ]);
        const jobCountById = new Map<string, number>(jobCounts.map((j: any) => [String(j._id), Number(j.count) || 0]));
        // Batch aggregate related party counts per subject
        const relCounts = await RelatedPartyModel.aggregate([
          { $match: { subjectId: { $in: ids } } },
          { $group: { _id: '$subjectId', count: { $sum: 1 } } },
        ]);
        const relCountById = new Map<string, number>(relCounts.map((r: any) => [String(r._id), Number(r.count) || 0]));

        rows = limited.map((d: any) => {
          const subjectId = d.spn || d.subject_id || d.subjectId;
          const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : null);
          const bAt = bestBooking(d);
          const strong = strongNotBondable(d);
          const baseAddr = (d.address || d.addr || null);
          const baseCity = d.city || null; const baseState = d.state || null; const baseZip = d.zip || null;
          const toAddrString = (addr: any) => {
            if (!addr) return '';
            if (typeof addr === 'string') return addr.trim();
            if (typeof addr === 'object') {
              const l1 = addr.line1 || addr.address1 || addr.street || addr.addr || '';
              const l2 = addr.line2 || addr.address2 || addr.unit || '';
              const c = addr.city || baseCity || '';
              const st = addr.state || baseState || '';
              const zp = addr.zip || addr.postal_code || baseZip || '';
              return [l1, l2, c, st, zp].filter(Boolean).join(', ').replace(/,\s*,/g, ', ').trim();
            }
            return String(addr).trim();
          };
          const baseAddressSnippet = (toAddrString(baseAddr) || [baseCity, baseState, baseZip].filter(Boolean).join(', ')) || null;
          const sid = String(subjectId);
          const enrichmentCount = jobCountById.get(sid) || 0;
          const relationsCount = relCountById.get(sid) || 0;
          return {
            subjectId: sid,
            bond: bondVal,
            dob: d.dob || null,
            bookingDate: bAt ? bAt.toISOString() : null,
            notBondable: !!d?.hcso_status?.notBondable,
            notBondableStrict: strong,
            moreChargesPossible: !!d?.hcso_status?.moreChargesPossible,
            bondExceptionText: d?.hcso_status?.bondExceptionText || null,
            baseAddressSnippet: baseAddressSnippet || null,
            enrichmentCount,
            relationsCount,
          };
        });
      }
      res.json({ windowHours, minBond, includeNotBondable, total, excludedStrictNotBondable, moreChargesPossibleCount: moreChargesCount, count: rows.length, rows });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/not_bondable?windowHours=48&minBond=0&strict=true&limit=50
  // Returns inmates classified as not bondable (strict by default) within booking window, with reasons for review
  router.get('/enrichment/not_bondable', async (req: any, res: any) => {
    try {
      const windowHours = Math.max(1, Math.min(168, Number(req.query.windowHours || 48)));
      const minBond = Number(req.query.minBond || 0);
      const limit = Math.min(200, Math.max(0, Number(req.query.limit || 50)));
      const strict = String(req.query.strict || 'true').toLowerCase() === 'true';
      const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
      function parseTs(v: any): Date | null {
        if (v == null) return null;
        if (v instanceof Date && !isNaN(v.getTime())) return v;
        if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
        if (typeof v === 'string') { const s=v.trim(); if(!s) return null; const d0=new Date(s); if(!isNaN(d0.getTime())) return d0; if (/^\d{10,13}$/.test(s)) { const n=Number(s); return new Date(s.length===13?n:n*1000);} }
        return null;
      }
      function bestBooking(doc: any): Date | null { for (const f of bookingFields) { if (Object.prototype.hasOwnProperty.call(doc,f)) { const d=parseTs((doc as any)[f]); if (d && !isNaN(d.getTime())) return d; } } return null; }
      const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const projection = { spn: 1, subject_id: 1, subjectId: 1, dob: 1, bond: 1, bond_amount: 1, hcso_status: 1, booking_datetime: 1, booking_at: 1, booking_time: 1, booking_date: 1, address: 1, addr: 1, city: 1, state: 1, zip: 1 };
      const docs = await InmateModel.find({ 'hcso_status.notInJail': { $ne: true } }, projection).sort({ _id: -1 }).limit(50000).lean();
      const strongRe = /(\bno\s*bond\b|\bnon[- ]?bondable\b|\bbond\s*denied\b|\bdenied\s*bond\b)/i;
      const rowsAll = docs.filter((d:any) => {
        const bAt = bestBooking(d); if (!bAt || bAt < cutoff) return false;
        const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : 0);
        if (bondVal < minBond) return false;
        const nb = !!d?.hcso_status?.notBondable;
        const txt = String(d?.hcso_status?.bondExceptionText || '');
        const strong = nb && strongRe.test(txt);
        return strict ? strong : nb;
      }).sort((a:any,b:any)=>{ const aB=bestBooking(a)?.getTime()||0; const bB=bestBooking(b)?.getTime()||0; return bB-aB; });
      const total = rowsAll.length;
      const rows = (limit>0? rowsAll.slice(0, limit) : rowsAll).map((d:any)=>{
        const subjectId = d.spn || d.subject_id || d.subjectId;
        const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : null);
        const bAt = bestBooking(d);
        const reason = String(d?.hcso_status?.bondExceptionText || '').trim() || null;
        const baseAddr = (d.address || d.addr || null);
        const baseCity = d.city || null; const baseState = d.state || null; const baseZip = d.zip || null;
        const toAddrString = (addr: any) => {
          if (!addr) return '';
          if (typeof addr === 'string') return addr.trim();
          if (typeof addr === 'object') {
            const l1 = addr.line1 || addr.address1 || addr.street || addr.addr || '';
            const l2 = addr.line2 || addr.address2 || addr.unit || '';
            const c = addr.city || baseCity || '';
            const st = addr.state || baseState || '';
            const zp = addr.zip || addr.postal_code || baseZip || '';
            return [l1, l2, c, st, zp].filter(Boolean).join(', ').replace(/,\s*,/g, ', ').trim();
          }
          return String(addr).trim();
        };
        const baseAddressSnippet = (toAddrString(baseAddr) || [baseCity, baseState, baseZip].filter(Boolean).join(', ')) || null;
        return { subjectId: String(subjectId), bond: bondVal, dob: d.dob || null, bookingDate: bAt ? bAt.toISOString() : null, notBondable: !!d?.hcso_status?.notBondable, reason, moreChargesPossible: !!d?.hcso_status?.moreChargesPossible, baseAddressSnippet: baseAddressSnippet || null };
      });
      res.json({ windowHours, minBond, strict, total, count: rows.length, rows });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/subject_summary?subjectId=SPN
  // Returns concise subject view with base data and last provider previews
  router.get('/enrichment/subject_summary', async (req: any, res: any) => {
    try {
      const subjectId = String(req.query.subjectId || '').trim();
      if (!subjectId) return res.status(400).json({ error: 'subjectId required' });
      const subject = await InmateModel.findOne({ $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] }).lean();
      if (!subject) return res.status(404).json({ error: 'subject not found' });
      const toAddrString = (addr: any, fallbacks: any) => {
        if (!addr) return '';
        if (typeof addr === 'string') return addr.trim();
        if (typeof addr === 'object') {
          const l1 = addr.line1 || addr.address1 || addr.street || addr.addr || '';
          const l2 = addr.line2 || addr.address2 || addr.unit || '';
          const c = addr.city || fallbacks.city || '';
          const st = addr.state || fallbacks.state || '';
          const zp = addr.zip || addr.postal_code || fallbacks.zip || '';
          return [l1, l2, c, st, zp].filter(Boolean).join(', ').replace(/,\s*,/g, ', ').trim();
        }
        return String(addr).trim();
      };
      const baseAddrSnippet = (toAddrString((subject as any).address || (subject as any).addr, { city: (subject as any).city, state: (subject as any).state, zip: (subject as any).zip })
        || [ (subject as any).city, (subject as any).state, (subject as any).zip ].filter(Boolean).join(', ')) || null;
      const spn = (subject as any).spn || (subject as any).subject_id || (subject as any).subjectId;
      // recent job (if any)
  const job: any = await EnrichmentJobModel.findOne({ subjectId: String(spn) }).sort({ updatedAt: -1 }).lean();
  const steps = (job?.steps || []).map((s: any) => ({ name: s.name, status: s.status, info: s.info }));
      // related parties
      const parties = await RelatedPartyModel.find({ subjectId: String(spn) }).limit(50).lean();
      // Heuristic: prefer family label when last names match and no explicit label present
      const getSubjLast = () => {
        const ln = String(((subject as any)?.last_name || '')).trim();
        if (ln) return ln;
        const nm = String(((subject as any)?.name || '')).trim();
        if (nm) { const parts = nm.split(/\s+/).filter(Boolean); return parts[parts.length - 1] || ''; }
        return '';
      };
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g,'').replace(/(.)\1+/g,'$1');
      const subjLastNorm = norm(getSubjLast());
      const rel = parties.map((p: any) => {
        const audits = Array.isArray((p as any).audits) ? (p as any).audits : [];
        const lastAudit = audits.length ? audits[audits.length - 1] : null;
  const auditLite = lastAudit ? { at: lastAudit.at, provider: lastAudit.provider, personsCount: lastAudit.personsCount, match: normalizeMatch((lastAudit as any).match), accepted: lastAudit.accepted, acceptance: lastAudit.acceptance, lastNameAgrees: lastAudit.lastNameAgrees, matchMin: lastAudit.matchMin, requireUnique: lastAudit.requireUnique, gainedData: (lastAudit as any).gainedData ?? null, netNewPhones: (lastAudit as any).netNewPhones ?? null, netNewEmails: (lastAudit as any).netNewEmails ?? null, netNewAddresses: (lastAudit as any).netNewAddresses ?? null } : null;
        const lastTargeted = audits.filter((a: any) => a && a.targeted === true).pop() || null;
        const lastTargetedAt = lastTargeted?.at ? new Date(lastTargeted.at) : null;
        const cooldownEndsAt = (lastTargetedAt && PARTY_PULL_COOLDOWN_MINUTES)
          ? new Date(lastTargetedAt.getTime() + PARTY_PULL_COOLDOWN_MINUTES * 60 * 1000)
          : null;
        const phones = Array.isArray((p as any)?.contacts?.phones) ? (p as any).contacts.phones : [];
        const emails = Array.isArray((p as any)?.contacts?.emails) ? (p as any).contacts.emails : [];
        const addresses = Array.isArray((p as any)?.addresses) ? (p as any).addresses : [];
        let relationType = p.relationType;
        let relationLabel = (p as any).relationLabel || null;
        if ((!relationLabel || relationLabel.toLowerCase() === 'associate') && subjLastNorm && p?.name) {
          const parts = String(p.name).split(/\s+/); const last = parts[parts.length-1]||'';
          if (norm(last) === subjLastNorm) { relationType = 'family'; relationLabel = relationLabel || 'family'; }
        }
        return ({ partyId: (p as any).partyId || null, name: p.name, relationType, relationLabel, confidence: p.confidence, lastAudit: auditLite, lastTargetedAt, cooldownEndsAt, phones, emails, addresses });
      });
      // Last Pipl payload preview scoped to this subject when available
      const lastPipl = await RawProviderPayloadModel
        .findOne({ provider: 'pipl', subjectId: String(spn) })
        .sort({ createdAt: -1 })
        .lean()
        || await RawProviderPayloadModel.findOne({ provider: 'pipl' }).sort({ createdAt: -1 }).lean();
      const piplPreview = lastPipl ? (() => {
        try {
          const payload = (lastPipl as any).payload || {};
          const resp = (payload && payload.response) ? payload.response : payload; // we store {request,response}
          // Pipl returns either person or possible_persons
          const personsRaw: any[] = Array.isArray((resp as any)?.possible_persons)
            ? (resp as any).possible_persons
            : ((resp as any)?.person ? [(resp as any).person] : []);
          const samples = personsRaw.slice(0, 2).map((p: any) => {
            const name = (Array.isArray(p?.names) && p.names[0])
              ? (p.names[0].display || [p.names[0].first, p.names[0].last].filter(Boolean).join(' ').trim())
              : undefined;
            const addrObj = Array.isArray(p?.addresses) && p.addresses[0] ? p.addresses[0] : undefined;
            const address = addrObj?.display || [addrObj?.street, addrObj?.city, addrObj?.state, addrObj?.postal_code || addrObj?.zip, addrObj?.country]
              .filter(Boolean)
              .join(', ');
            const match = typeof p?.['@match'] === 'number' ? p['@match'] : (typeof (resp as any)?.['@match'] === 'number' ? (resp as any)['@match'] : undefined);
            return { name: name || null, address: (address || '').trim() || null, match: match ?? null };
          });
          return { when: (lastPipl as any).createdAt || null, personsCount: personsRaw.length, samples };
        } catch {
          return { when: (lastPipl as any).createdAt || null, personsCount: 0, samples: [] };
        }
      })() : null;
      const facts = (subject as any).facts || {};
      // Prefer full name when available; if missing, fall back to the last Pipl payload's first person name
      let displayName = [ (subject as any).first_name, (subject as any).last_name ].filter(Boolean).join(' ').trim() || (subject as any).name || '';
      if (!displayName && piplPreview && Array.isArray((piplPreview as any).samples) && (piplPreview as any).samples[0]?.name) {
        displayName = String((piplPreview as any).samples[0].name || '').trim();
      }
      const safeName = displayName || null;
      const summary = {
        subjectId: String(spn),
        name: safeName,
        dob: (subject as any).dob || null,
        bond: (subject as any).bond_amount ?? (subject as any).bond ?? null,
        baseAddress: baseAddrSnippet,
        phones: (subject as any).phones || [],
        flags: (subject as any).hcso_status || {},
        enrichment_status: (subject as any).enrichment_status || null,
        facts,
        steps,
        relatedParties: rel,
        piplPreview,
      };
      // For UI compatibility: also expose a flat shape with legacy keys
  const related_parties = rel.map((r: any) => ({ partyId: r.partyId || null, name: r.name, relation: r.relationType, relationLabel: r.relationLabel || null, phones: r.phones || [], emails: r.emails || [], addresses: r.addresses || [], match: normalizeMatch(r?.lastAudit?.match), accepted: r?.lastAudit?.accepted ?? null, netNewPhones: r?.lastAudit?.netNewPhones ?? null, netNewEmails: r?.lastAudit?.netNewEmails ?? null, netNewAddresses: r?.lastAudit?.netNewAddresses ?? null }));
      // Subject-level provider summaries
      // Subject-level provider summaries
      let pipl = (subject as any)?.pipl || null;
      // Fallback: derive a minimal pipl summary from the latest raw payload if subject.pipl is missing
      if (!pipl && lastPipl) {
        try {
          const payload = (lastPipl as any).payload || {};
          const resp = (payload && payload.response) ? payload.response : payload;
          const personsRaw: any[] = Array.isArray((resp as any)?.possible_persons)
            ? (resp as any).possible_persons
            : ((resp as any)?.person ? [(resp as any).person] : []);
          let best: any = null; let bestM = -1;
          for (const p of personsRaw) {
            const m = typeof p?.['@match'] === 'number' ? p['@match'] : (typeof (resp as any)?.['@match'] === 'number' ? (resp as any)['@match'] : 0);
            if (m > bestM) { bestM = m; best = p; }
          }
          if (best) {
            const phones = Array.isArray(best?.phones) ? best.phones.map((pp: any) => pp?.display_international || pp?.number || String(pp)).filter(Boolean) : [];
            const emails = Array.isArray(best?.emails) ? best.emails.map((e: any) => e?.address || String(e)).filter(Boolean) : [];
            const addresses = Array.isArray(best?.addresses)
              ? best.addresses.map((a: any) => a?.display || [a?.street, a?.city, a?.state, a?.postal_code || a?.zip, a?.country].filter(Boolean).join(', ')).filter(Boolean)
              : [];
            pipl = { asOf: (lastPipl as any).createdAt || new Date().toISOString(), matchScore: bestM >= 0 ? bestM : null, phones, emails, addresses } as any;
          }
        } catch {}
      }
      const pdl = (subject as any)?.pdl || null;
      const piplLegacy = (() => {
        if (!piplPreview) return null;
        const samples = Array.isArray((piplPreview as any).samples) ? (piplPreview as any).samples : [];
        const addrPreview = samples.map((s: any) => s?.address).filter(Boolean).slice(0, 2);
        const matches = typeof (piplPreview as any).personsCount === 'number' ? (piplPreview as any).personsCount : samples.length;
        return { when: (piplPreview as any).when || null, matches, addrPreview };
      })();
  res.json({ ok: true, summary, facts, related_parties, pipl, pdl, piplPreview: piplLegacy ?? piplPreview });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/coverage24h?minBond=1000 -> { total, haveDob, notInJail, unresolved, pct }
  router.get('/enrichment/coverage24h', async (req: any, res: any) => {
    try {
      const minBond = Number(req.query.minBond || 1000);
      const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
      function parseTs(v: any): Date | null {
        if (v == null) return null;
        if (v instanceof Date && !isNaN(v.getTime())) return v;
        if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
        if (typeof v === 'string') {
          const s = v.trim();
          if (!s) return null;
          const d0 = new Date(s);
          if (!isNaN(d0.getTime())) return d0;
          if (/^\d{10,13}$/.test(s)) {
            const n = Number(s);
            return new Date(s.length === 13 ? n : n * 1000);
          }
        }
        return null;
      }
      function bestBooking(doc: any): Date | null {
        for (const f of bookingFields) {
          if (Object.prototype.hasOwnProperty.call(doc, f)) {
            const d = parseTs((doc as any)[f]);
            if (d && !isNaN(d.getTime())) return d;
          }
        }
        return null;
      }
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
      const docs = await InmateModel.find({}, { dob: 1, hcso_status: 1, spn: 1, subject_id: 1, subjectId: 1, booking_datetime: 1, booking_at: 1, booking_time: 1, booking_date: 1, bond: 1, bond_amount: 1 })
        .sort({ _id: -1 })
        .limit(30000)
        .lean();
      const recent = docs.filter((d: any) => {
        const b = bestBooking(d);
        const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : 0);
        return b && b >= cutoff && bondVal >= minBond;
      });
      let haveDob = 0, notInJail = 0, unresolved = 0, notBondable = 0, moreCharges = 0;
      for (const d of recent) {
        const dobOk = d.dob != null && String(d.dob).trim() !== '';
        const notIn = !!(d.hcso_status && d.hcso_status.notInJail);
        if (d.hcso_status?.notBondable) notBondable++;
        if (d.hcso_status?.moreChargesPossible) moreCharges++;
        if (dobOk) haveDob++; else if (notIn) notInJail++; else unresolved++;
      }
      const total = recent.length;
      const pct = total ? Math.round(((haveDob + notInJail) / total) * 1000) / 10 : 0;
      res.json({ total, haveDob, notInJail, unresolved, pct, minBond, notBondable, moreCharges });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/batch?suffix=1760644231 -> { countsByStatus, countsByStep, rows }
  router.get('/enrichment/batch', async (req: any, res: any) => {
    try {
      const suffix = String(req.query.suffix || '').trim();
      const minBond = req.query.minBond != null ? Number(req.query.minBond) : undefined;
  const stepStatus = String(req.query.stepStatus || '').toUpperCase().trim(); // SUCCEEDED | SKIPPED | UNRESOLVED
  const flagNotBondable = String(req.query.notBondable || '').toLowerCase() === 'true';
  const flagMoreCharges = String(req.query.moreCharges || '').toLowerCase() === 'true';
      const windowHours = req.query.windowHours != null ? Math.max(1, Math.min(168, Number(req.query.windowHours))) : 24;
      const query: any = suffix ? { jobId: new RegExp(`_dob-only_${suffix}$`) } : { createdAt: { $gte: new Date(Date.now() - 3 * 3600 * 1000) } };
      const jobs = await EnrichmentJobModel.find(query, { jobId: 1, subjectId: 1, status: 1, steps: 1, createdAt: 1, updatedAt: 1 }).sort({ createdAt: -1 }).limit(2000).lean();
      const countsByStatus: Record<string, number> = {};
      for (const j of jobs) {
        countsByStatus[j.status] = (countsByStatus[j.status] || 0) + 1;
      }
      let countsByStep: Record<string, number> = { hcso_dob_succeeded: 0, hcso_dob_skipped: 0, hcso_dob_unresolved: 0 };
      let rows = jobs.map((j: any) => {
        const st = (j.steps || []).find((s: any) => s.name === 'hcso_dob');
        return ({ jobId: j.jobId, subjectId: j.subjectId, status: j.status, hcso_dob: st?.status || 'N/A', reason: st?.info?.reason || st?.info?.error || null });
      });
      // Server-side filter by stepStatus when provided
      if (stepStatus && stepStatus !== 'ALL') {
        rows = rows.filter((r: any) => (String(r.hcso_dob || '').toUpperCase() === stepStatus));
      }
      // Optionally apply bond/flags filter by looking up inmate docs
      if (minBond != null || flagNotBondable || flagMoreCharges) {
        const ids = rows.map((r: any) => r.subjectId);
        const inmates = await InmateModel.find({ $or: [{ spn: { $in: ids } }, { subject_id: { $in: ids } }, { subjectId: { $in: ids } }] }, { spn: 1, subject_id: 1, subjectId: 1, bond: 1, bond_amount: 1, hcso_status: 1 }).lean();
        const byId = new Map<string, any>();
        for (const d of inmates) {
          const key = d.spn || d.subject_id || d.subjectId;
          byId.set(String(key), d);
        }
        rows = rows.filter((r: any) => {
          const doc = byId.get(String(r.subjectId));
          const bondVal = doc ? (typeof doc.bond_amount === 'number' ? doc.bond_amount : (typeof doc.bond === 'number' ? doc.bond : 0)) : 0;
          if (minBond != null && bondVal < minBond) return false;
          if (flagNotBondable && !(doc?.hcso_status?.notBondable)) return false;
          if (flagMoreCharges && !(doc?.hcso_status?.moreChargesPossible)) return false;
          return true;
        });
      }
      // If no recent jobs matched, fall back to derived inmate list from recent booking window
      if (rows.length === 0) {
        const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
        function parseTs(v: any): Date | null {
          if (v == null) return null;
          if (v instanceof Date && !isNaN(v.getTime())) return v;
          if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
          if (typeof v === 'string') {
            const s = v.trim();
            if (!s) return null;
            const d0 = new Date(s);
            if (!isNaN(d0.getTime())) return d0;
            if (/^\d{10,13}$/.test(s)) {
              const n = Number(s);
              return new Date(s.length === 13 ? n : n * 1000);
            }
          }
          return null;
        }
        function bestBooking(doc: any): Date | null {
          for (const f of bookingFields) {
            if (Object.prototype.hasOwnProperty.call(doc, f)) {
              const d = parseTs((doc as any)[f]);
              if (d && !isNaN(d.getTime())) return d;
            }
          }
          return null;
        }
        const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
        const docs = await InmateModel.find({}, { spn: 1, subject_id: 1, subjectId: 1, dob: 1, hcso_status: 1, bond: 1, bond_amount: 1, booking_datetime: 1, booking_at: 1, booking_time: 1, booking_date: 1 })
          .sort({ _id: -1 })
          .limit(50000)
          .lean();
        let candidates = docs.filter((d: any) => {
          const b = bestBooking(d);
          if (!b || b < cutoff) return false;
          const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : 0);
          if (minBond != null && bondVal < minBond) return false;
          if (flagNotBondable && !(d?.hcso_status?.notBondable)) return false;
          if (flagMoreCharges && !(d?.hcso_status?.moreChargesPossible)) return false;
          return true;
        });
        // Build derived rows
        rows = candidates.map((d: any) => {
          const subjectId = d.spn || d.subject_id || d.subjectId;
          const dobOk = d.dob != null && String(d.dob).trim() !== '';
          const notIn = !!(d.hcso_status && d.hcso_status.notInJail);
          const hcso_dob = dobOk ? 'SUCCEEDED' : (notIn ? 'SKIPPED' : 'UNRESOLVED');
          return { jobId: '-', subjectId: String(subjectId), status: 'N/A', hcso_dob, reason: dobOk ? null : (notIn ? 'NOT_IN_JAIL' : 'DOB_NOT_FOUND') };
        });
        // Apply stepStatus filter to derived rows when requested
        if (stepStatus && stepStatus !== 'ALL') {
          rows = rows.filter((r: any) => (String(r.hcso_dob || '').toUpperCase() === stepStatus));
        }
      }
      // Finalize counts by step based on the rows being returned
      countsByStep = { hcso_dob_succeeded: 0, hcso_dob_skipped: 0, hcso_dob_unresolved: 0 };
      for (const r of rows) {
        const st = String(r.hcso_dob || '').toUpperCase();
        if (st === 'SUCCEEDED') countsByStep.hcso_dob_succeeded++;
        else if (st === 'SKIPPED') countsByStep.hcso_dob_skipped++;
        else if (st === 'UNRESOLVED' || st === 'FAILED') countsByStep.hcso_dob_unresolved++;
      }
      rows = rows.slice(0, 50);
      res.json({ total: jobs.length, countsByStatus, countsByStep, rows });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/unresolved_breakdown?suffix=... -> { totalUnresolved, reasons: { NO_RECORD, DOB_NOT_FOUND, error, other } }
  router.get('/enrichment/unresolved_breakdown', async (req: any, res: any) => {
    try {
      const suffix = String(req.query.suffix || '').trim();
      const jobQuery: any = suffix ? { jobId: new RegExp(`_dob-only_${suffix}$`) } : { createdAt: { $gte: new Date(Date.now() - 6 * 3600 * 1000) } };
      const jobs = await EnrichmentJobModel.find(jobQuery, { jobId: 1, steps: 1 }).limit(5000).lean();
      let totalUnresolved = 0;
      const reasons: Record<string, number> = { NO_RECORD: 0, DOB_NOT_FOUND: 0, error: 0, other: 0 };
      for (const j of jobs) {
        const st = (j.steps || []).find((s: any) => s.name === 'hcso_dob');
        if (st && (st.status === 'UNRESOLVED' || st.status === 'FAILED')) {
          totalUnresolved++;
          const r = (st.info && (st.info.reason || (st.info.error ? 'error' : ''))) || '';
          if (r && reasons.hasOwnProperty(r)) reasons[r]++;
          else if (r) reasons.other++;
          else reasons.other++;
        }
      }
      res.json({ totalUnresolved, reasons });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/unresolved_samples?suffix=...&limit=3 -> [{subjectId, jobId}]
  router.get('/enrichment/unresolved_samples', async (req: any, res: any) => {
    try {
      const suffix = String(req.query.suffix || '').trim();
      const limit = Math.max(1, Math.min(50, Number(req.query.limit || 3)));
      const minBond = req.query.minBond != null ? Number(req.query.minBond) : undefined;
      const jobQuery: any = suffix ? { jobId: new RegExp(`_dob-only_${suffix}$`) } : { createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } };
      jobQuery.steps = { $elemMatch: { name: 'hcso_dob', status: { $in: ['UNRESOLVED', 'FAILED'] } } };
      let jobs = await EnrichmentJobModel.find(jobQuery, { jobId: 1, subjectId: 1, steps: 1 }).sort({ updatedAt: -1 }).limit(1000).lean();
      // Optional bond filter
      if (minBond != null) {
        const ids = jobs.map((j: any) => j.subjectId);
        const inmates = await InmateModel.find({ $or: [{ spn: { $in: ids } }, { subject_id: { $in: ids } }, { subjectId: { $in: ids } }] }, { spn: 1, subject_id: 1, subjectId: 1, bond: 1, bond_amount: 1 }).lean();
        const byId = new Map<string, any>();
        for (const d of inmates) {
          const key = d.spn || d.subject_id || d.subjectId;
          byId.set(String(key), d);
        }
        jobs = jobs.filter((j: any) => {
          const doc = byId.get(String(j.subjectId));
          const bondVal = doc ? (typeof doc.bond_amount === 'number' ? doc.bond_amount : (typeof doc.bond === 'number' ? doc.bond : 0)) : 0;
          return bondVal >= minBond;
        });
      }
      const rows = jobs.slice(0, limit).map((j: any) => {
        const st = (j.steps || []).find((s: any) => s.name === 'hcso_dob');
        return ({ subjectId: j.subjectId, jobId: j.jobId, reason: st?.info?.reason || st?.info?.error || null });
      });
      res.json({ count: rows.length, rows });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/provider_stats?windowHours=24 -> provider step counts and cache stats
  router.get('/enrichment/provider_stats', async (req: any, res: any) => {
    try {
      const windowHours = Math.max(1, Math.min(168, Number(req.query.windowHours || 24)));
      const since = new Date(Date.now() - windowHours * 3600 * 1000);
      const jobs = await EnrichmentJobModel.find({ updatedAt: { $gte: since } }, { steps: 1 }).limit(5000).lean();
      const stepCounts: Record<string, number> = { pdl_search_succeeded: 0, pdl_search_skipped: 0, pdl_search_unresolved: 0, pipl_search_succeeded: 0, pipl_search_skipped: 0, pipl_search_unresolved: 0, whitepages_succeeded: 0, whitepages_skipped: 0, whitepages_unresolved: 0 };
      for (const j of jobs) {
        for (const s of (j.steps || [])) {
          if (s.name === 'pdl_search') {
            // Default provider mapping: if PDL is disabled and Pipl is enabled, attribute to Pipl
            const prov = (s as any).info?.provider || (((config as any).providerPiplEnabled && !(config as any).providerPdlEnabled) ? 'pipl' : 'pdl');
            const key = prov === 'pipl' ? 'pipl' : 'pdl';
            if (s.status === 'SUCCEEDED') stepCounts[`${key}_search_succeeded` as keyof typeof stepCounts]++;
            else if (s.status === 'SKIPPED') stepCounts[`${key}_search_skipped` as keyof typeof stepCounts]++;
            else if (s.status === 'UNRESOLVED' || s.status === 'FAILED') stepCounts[`${key}_search_unresolved` as keyof typeof stepCounts]++;
          }
          if (s.name === 'whitepages') {
            if (s.status === 'SUCCEEDED') stepCounts.whitepages_succeeded++;
            else if (s.status === 'SKIPPED') stepCounts.whitepages_skipped++;
            else if (s.status === 'UNRESOLVED' || s.status === 'FAILED') stepCounts.whitepages_unresolved++;
          }
        }
      }
      // Cache and usage stats from raw payloads
      const cacheSince = since;
      const rawPdl = await mongoose.model('raw_provider_payloads').find({ createdAt: { $gte: cacheSince }, provider: 'pdl', step: 'pdl_search' }, { payload: 1, createdAt: 1 }).limit(20000).lean();
      const rawPipl = await mongoose.model('raw_provider_payloads').find({ createdAt: { $gte: cacheSince }, provider: 'pipl', step: 'pipl_search' }, { payload: 1, createdAt: 1 }).limit(20000).lean();
      let pdlCacheHits = 0, pdlNetwork = 0; let pdlHour = 0, pdlDay = 0;
      let piplNetwork = 0; let piplHour = 0, piplDay = 0;
      const hourCut = new Date(Date.now() - 3600 * 1000);
      const dayCut = new Date(Date.now() - 24 * 3600 * 1000);
      for (const r of rawPdl) {
        const fromCache = !!(r as any)?.payload?.fromCache;
        if (fromCache) pdlCacheHits++; else pdlNetwork++;
        const t = new Date((r as any).createdAt);
        if (t >= hourCut && !fromCache) pdlHour++;
        if (t >= dayCut && !fromCache) pdlDay++;
      }
      for (const r of rawPipl) {
        piplNetwork++;
        const t = new Date((r as any).createdAt);
        if (t >= hourCut) piplHour++;
        if (t >= dayCut) piplDay++;
      }
      const budgets = {
        pdl: { maxPerHour: (config as any).pdlMaxPerHour, maxPerDay: (config as any).pdlMaxPerDay, unitCostUsd: (config as any).pdlUnitCostUsd },
        pipl: { maxPerHour: (config as any).piplMaxPerHour, maxPerDay: (config as any).piplMaxPerDay, unitCostUsd: (config as any).piplUnitCostUsd },
        whitepages: { maxPerHour: (config as any).wpMaxPerHour, maxPerDay: (config as any).wpMaxPerDay, unitCostUsd: (config as any).wpUnitCostUsd },
      };
      const hourUsagePct = budgets.pdl.maxPerHour ? Math.round((pdlHour / budgets.pdl.maxPerHour) * 1000)/10 : 0;
      const dayUsagePct = budgets.pdl.maxPerDay ? Math.round((pdlDay / budgets.pdl.maxPerDay) * 1000)/10 : 0;
      const piplHourPct = budgets.pipl.maxPerHour ? Math.round((piplHour / budgets.pipl.maxPerHour) * 1000)/10 : 0;
      const piplDayPct = budgets.pipl.maxPerDay ? Math.round((piplDay / budgets.pipl.maxPerDay) * 1000)/10 : 0;
      const cost = {
        pdl: { estimatedUsd: (pdlNetwork || 0) * ((config as any).pdlUnitCostUsd || 0), networkCalls: pdlNetwork, cacheHits: pdlCacheHits, hourUsage: { used: pdlHour, max: budgets.pdl.maxPerHour, pct: hourUsagePct }, dayUsage: { used: pdlDay, max: budgets.pdl.maxPerDay, pct: dayUsagePct } },
        pipl: { estimatedUsd: (piplNetwork || 0) * ((config as any).piplUnitCostUsd || 0), networkCalls: piplNetwork, hourUsage: { used: piplHour, max: budgets.pipl.maxPerHour, pct: piplHourPct }, dayUsage: { used: piplDay, max: budgets.pipl.maxPerDay, pct: piplDayPct } },
      };
      const enabled = { pdl: !!(config as any).providerPdlEnabled, pipl: !!(config as any).providerPiplEnabled, whitepages: !!(config as any).providerWhitepagesEnabled };
      res.json({ windowHours, steps: stepCounts, pdl: { cacheHits: pdlCacheHits, networkCalls: pdlNetwork }, pipl: { networkCalls: piplNetwork }, budgets, cost, enabled });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/providers -> enumerate enrichment-owned providers for UI dropdowns
  // Returns all known providers with enabled flags and basic capabilities so the UI can avoid
  // coupling to the Dashboard server registry.
  router.get('/enrichment/providers', async (_req: any, res: any) => {
    try {
      const piplEnabled = !!((config as any).providerPiplEnabled && (config as any).piplApiKey);
      const wpEnabled = !!((config as any).providerWhitepagesEnabled && (config as any).whitepagesApiKey);
      const pdlEnabled = !!((config as any).providerPdlEnabled && (config as any).pdlApiKey);
      const providers = [
        {
          id: 'pipl',
          label: 'Pipl',
          enabled: piplEnabled,
          ttlHours: (config as any).rawPayloadTtlHours ?? 24,
          capabilities: { matchScore: true, relationships: true, contacts: true },
          actions: [
            { id: 'first_pull', method: 'POST', path: '/api/enrichment/pipl_first_pull', description: 'Find best match and update subject facts/relationships' },
            { id: 'party_pull', method: 'POST', path: '/api/enrichment/related_party_pull', description: 'Enrich related parties by name + location' },
          ],
          tests: [ { method: 'GET', path: '/api/providers/pipl/test' } ],
        },
        {
          id: 'whitepages',
          label: 'Whitepages Pro',
          enabled: wpEnabled,
          ttlHours: (config as any).rawPayloadTtlHours ?? 24,
          capabilities: { phoneValidation: true },
          actions: [
            { id: 'validate_party_phones', method: 'POST', path: '/api/enrichment/related_party_validate_phones', description: 'Validate stored related-party phones' },
          ],
          tests: [ { method: 'GET', path: '/api/providers/whitepages/test' } ],
        },
        {
          id: 'pdl',
          label: 'People Data Labs',
          enabled: pdlEnabled,
          ttlHours: (config as any).rawPayloadTtlHours ?? 24,
          capabilities: { relationships: true, contacts: true },
          actions: [
            { id: 'first_pull', method: 'POST', path: '/api/enrichment/pdl_first_pull', description: 'Find best match and update subject facts/relationships' },
          ],
          tests: [ { method: 'GET', path: '/api/providers/pdl/test' } ],
        },
      ];
      res.json({ ok: true, providers });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /api/enrichment/provider_unresolved_breakdown?windowHours=24
  router.get('/enrichment/provider_unresolved_breakdown', async (req: any, res: any) => {
    try {
      const windowHours = Math.max(1, Math.min(168, Number(req.query.windowHours || 24)));
      const since = new Date(Date.now() - windowHours * 3600 * 1000);
      const jobs = await EnrichmentJobModel.find({ updatedAt: { $gte: since } }, { steps: 1 }).limit(10000).lean();
      const breakdown: any = { pdl_search: {}, pipl_search: {}, whitepages: {} };
      function inc(map: any, key: string){ map[key] = (map[key] || 0) + 1; }
      for (const j of jobs) {
        for (const s of (j.steps || [])) {
          if ((s.name === 'pdl_search' || s.name === 'whitepages') && (s.status === 'UNRESOLVED' || s.status === 'FAILED')) {
            const reason = (s.info?.reason || (s.info?.error ? 'PROVIDER_ERROR' : 'UNKNOWN')) as string;
            if (s.name === 'pdl_search'){
              const prov = (s as any).info?.provider || (((config as any).providerPiplEnabled && !(config as any).providerPdlEnabled) ? 'pipl' : 'pdl');
              if (prov === 'pipl') inc(breakdown['pipl_search'], reason); else inc(breakdown['pdl_search'], reason);
            } else {
              inc(breakdown[s.name], reason);
            }
          }
        }
      }
      res.json({ windowHours, breakdown });
    } catch (e: any) {
      res.status(500).json({ error: String(e) });
    }
  });

  // GET /api/enrichment/crm_suggestions?subjectId=SPN
  // Returns a suggested CRM patch derived from subject facts and related parties
  router.get('/enrichment/crm_suggestions', async (req: any, res: any) => {
    try {
      const subjectId = String(req.query.subjectId || '').trim();
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      const subject = await InmateModel.findOne({ $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] }, { facts: 1, address: 1, addr: 1, city: 1, state: 1, zip: 1, first_name: 1, last_name: 1, pdl: 1 }).lean();
      if (!subject) return res.status(404).json({ ok: false, error: 'SUBJECT_NOT_FOUND' });
      const facts = (subject as any).facts || {};
      function pickFirst(arr: any[]): string | null { if (!Array.isArray(arr)) return null; for (const v of arr) { const s = String(v ?? '').trim(); if (s) return s; } return null; }
      // Base address if facts are empty
      function toAddrString(addr: any, fallbacks: any) {
        if (!addr) return '';
        if (typeof addr === 'string') return addr.trim();
        if (typeof addr === 'object') {
          const l1 = addr.line1 || addr.address1 || addr.street || addr.addr || '';
          const l2 = addr.line2 || addr.address2 || addr.unit || '';
          const c = addr.city || fallbacks.city || '';
          const st = addr.state || fallbacks.state || '';
          const zp = addr.zip || addr.postal_code || fallbacks.zip || '';
          return [l1, l2, c, st, zp].filter(Boolean).join(', ').replace(/,\s*,/g, ', ').trim();
        }
        return String(addr).trim();
      }
      const fallbackAddr = toAddrString((subject as any).address || (subject as any).addr, { city: (subject as any).city, state: (subject as any).state, zip: (subject as any).zip })
        || [ (subject as any).city, (subject as any).state, (subject as any).zip ].filter(Boolean).join(', ');
      const sugPhone = pickFirst((facts as any).phones || ((subject as any).pdl?.phones) || []);
      const sugEmail = pickFirst((facts as any).emails || ((subject as any).pdl?.emails) || []);
      const sugAddr = pickFirst((facts as any).addresses) || fallbackAddr || null;
      // Employer/jobTitle are not populated in this pipeline yet; leave null for now
      const sugEmployer = (facts as any).employer || null;
      const sugJobTitle = (facts as any).jobTitle || null;
      // Contacts from related parties
      const parties = await RelatedPartyModel.find({ subjectId: String(subjectId) }, { name: 1, relationType: 1, contacts: 1 }).sort({ updatedAt: -1 }).limit(20).lean();
      const contacts: any[] = [];
      const seen = new Set<string>();
      for (const p of parties) {
        const name = String((p as any).name || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const rel = (p as any).relationType || null;
        const ph = Array.isArray((p as any)?.contacts?.phones) ? (p as any).contacts.phones.find((x: any) => String(x || '').trim()) : null;
        const em = Array.isArray((p as any)?.contacts?.emails) ? (p as any).contacts.emails.find((x: any) => String(x || '').trim()) : null;
        contacts.push({ name, relation: rel, phone: ph || null, email: em || null });
        if (contacts.length >= 10) break;
      }
      const suggestions = { phone: sugPhone, email: sugEmail, address: sugAddr || null, employer: sugEmployer, jobTitle: sugJobTitle, contacts };
      const sources = {
        phone: ((facts as any).phones?.length ? 'facts' : ((subject as any).pdl?.phones?.length ? 'pdl' : null)),
        email: ((facts as any).emails?.length ? 'facts' : ((subject as any).pdl?.emails?.length ? 'pdl' : null)),
        address: ((facts as any).addresses?.length ? 'facts' : (fallbackAddr ? 'base' : null)),
        contacts: parties.length ? 'related_parties' : null,
      };
      res.json({ ok: true, subjectId: String(subjectId), suggestions, sources });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/enrichment/pipl_first_pull { subjectId?: string, overrideLocation?: boolean, aggressive?: boolean }
  // By default, performs a single strict attempt (name + dob + full address). When aggressive=true, runs up to two
  // additional fallbacks (state-only, then name-only) if earlier attempts return no persons.
  router.post('/enrichment/pipl_first_pull', async (req: any, res: any) => {
    try {
      if (!(config as any).piplApiKey || !(config as any).providerPiplEnabled) return res.status(400).json({ ok: false, error: 'PIPL_DISABLED_OR_MISSING_KEY' });
      let { subjectId, overrideLocation, aggressive } = req.body as { subjectId?: string; overrideLocation?: boolean; aggressive?: boolean };
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      const subject = await InmateModel.findOne({ $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] });
      if (!subject) return res.status(404).json({ ok: false, error: 'SUBJECT_NOT_FOUND' });
      // Helper: extract the richest address we can for Pipl (street, city, state, postal_code, country)
      function buildPiplAddressFromSubject(s: any) {
        const baseCity = String(s.city || '').trim();
        const baseState = String(s.state || '').trim();
        const baseZip = String((s.zip || s.postal_code || '')).trim();
        const baseCountry = 'US';
        const defaultCity = 'Houston';
        const defaultState = 'TX'; // Harris County, TX by default when missing
        let street = '';
        const raw = (s.address ?? s.addr) as any;
        if (raw && typeof raw === 'object') {
          const l1 = String(raw.line1 || raw.address1 || raw.street || raw.addr || '').trim();
          const l2 = String(raw.line2 || raw.address2 || raw.unit || '').trim();
          street = [l1, l2].filter(Boolean).join(' ').trim();
        } else if (raw && typeof raw === 'string') {
          street = raw.trim();
        }
        const city = (overrideLocation ? defaultCity : (baseCity || defaultCity));
        const state = (overrideLocation ? defaultState : (baseState || defaultState));
        const postal_code = baseZip || undefined;
        const addr: any = { country: baseCountry };
        if (street) addr.street = street;
        if (city) addr.city = city;
        if (state) addr.state = state;
        if (postal_code) addr.postal_code = postal_code;
        return addr;
      }
  const pf = (subject as any).first_name || '';
  const pl = (subject as any).last_name || '';
  const sdob = (subject as any).dob || undefined;
      const pPerson: any = {};
      if (pf || pl) pPerson.names = [{ first: pf, last: pl }];
      if (sdob) {
        try {
          const d = new Date(sdob);
          if (!isNaN(d.getTime())) {
            const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
            pPerson.dob = `${y}-${m}-${dd}`;
          }
        } catch {}
      }
  // Include the richest address we have (street/city/state/postal_code/country)
  const piplAddr = buildPiplAddressFromSubject(subject as any);
  pPerson.addresses = [piplAddr];
      async function callPipl(personObj: any, attempt: number){
        const bodyReq = { key: (config as any).piplApiKey, person: personObj };
        const r = await fetch('https://api.pipl.com/search/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyReq) } as any);
        if (!r.ok) {
          let errTxt: string | null = null;
          try { errTxt = await r.text(); } catch {}
          throw new Error(`PIPL_HTTP_${r.status}${errTxt ? ` ${String(errTxt).slice(0, 200)}`: ''}`);
        }
        const json = await r.json();
        try { await RawProviderPayloadModel.create({ provider: 'pipl', subjectId: String(subjectId), step: 'pipl_first_pull', payload: { request: { person: personObj, attempt }, response: json }, ttlExpiresAt: new Date(Date.now() + (config as any).rawPayloadTtlHours * 3600 * 1000) }); } catch {}
        return json;
      }
      // Attempt 1: name + dob + full address (strict)
      let body: any = await callPipl(pPerson, 1);
      const personsCount1 = Number(body?.['@persons_count'] || 0);
      // Only when explicitly requested (aggressive) do we try additional fallbacks
      if (!personsCount1 && aggressive) {
        const stateVal = String(piplAddr.state || 'TX');
        const p2 = { ...pPerson, addresses: [{ state: stateVal, country: 'US' }] };
        delete (p2 as any).addresses[0].city;
        delete (p2 as any).addresses[0].street;
        delete (p2 as any).addresses[0].postal_code;
        body = await callPipl(p2, 2);
        const personsCount2 = Number(body?.['@persons_count'] || 0);
        if (!personsCount2) {
          const p3: any = {};
          if (pf || pl) p3.names = [{ first: pf, last: pl }];
          body = await callPipl(p3, 3);
        }
      }
      const toNorm = (p: any) => {
        const phones = Array.isArray(p?.phones) ? p.phones.map((pp: any)=>pp?.display_international || pp?.number || pp) : [];
        const emails = Array.isArray(p?.emails) ? p.emails.map((e: any)=>e?.address || e) : [];
        const addresses = Array.isArray(p?.addresses) ? p.addresses.map((a: any)=>({ street: [a?.street, a?.city, a?.state, a?.country].filter(Boolean).join(', ') })) : [];
        const relationships = Array.isArray(p?.relationships) ? p.relationships : (Array.isArray(p?.relatives) ? p.relatives : []);
        const m = typeof p['@match'] === 'number' ? p['@match'] : (typeof body['@match'] === 'number' ? body['@match'] : 0.8);
        return { phones, emails, addresses, relationships, m };
      };
      let matchesArr: any[] = [];
      if (Array.isArray(body?.possible_persons) && body.possible_persons.length) {
        matchesArr = body.possible_persons.map((pp: any)=>toNorm(pp));
      } else if (body?.person) {
        matchesArr = [toNorm(body.person)];
      }
      const best = matchesArr.sort((a,b)=> (b.m||0) - (a.m||0) )[0] || { phones: [], emails: [], addresses: [], relationships: [], m: 0 };
    const { phones, emails, addresses, relationships, m: matchScore } = best;
  try { await RawProviderPayloadModel.create({ provider: 'pipl', subjectId: String(subjectId), step: 'pipl_first_pull_summary', payload: { phase: 'summary', request: { person: pPerson }, response: body, bestScore: matchScore }, ttlExpiresAt: new Date(Date.now() + (config as any).rawPayloadTtlHours * 3600 * 1000) }); } catch {}
      // Persist to subject facts using atomic update to avoid silent schema issues
      try {
        const phonesU = Array.from(new Set((phones || []).map((x: any)=> String(x||'').trim()).filter(Boolean))).slice(0, 20);
        const emailsU = Array.from(new Set((emails || []).map((x: any)=> String(x||'').trim()).filter(Boolean))).slice(0, 20);
        const addrU0 = Array.isArray(addresses) ? addresses.map((a: any)=> {
          if (!a) return '';
          if (typeof a === 'string') return a.trim();
          const disp = a.display || a.street || '';
          const city = a.city || '';
          const st = a.state || '';
          const zp = a.postal_code || a.zip || '';
          const ctry = a.country || '';
          const s = disp || [a?.line1||a?.address1||'', a?.line2||a?.address2||'', city, st, zp, ctry].filter(Boolean).join(', ');
          return String(s).trim();
        }) : [];
        const addressesU = Array.from(new Set(addrU0.filter(Boolean))).slice(0, 20);
        if (phonesU.length || emailsU.length || addressesU.length) {
          await InmateModel.updateOne(
            { _id: (subject as any)._id },
            {
              ...(phonesU.length ? { $addToSet: { 'facts.phones': { $each: phonesU } } } : {}),
              ...(emailsU.length ? { $addToSet: { 'facts.emails': { $each: emailsU } } } : {}),
              ...(addressesU.length ? { $addToSet: { 'facts.addresses': { $each: addressesU } } } : {}),
            }
          );
        }
        // Persist a concise pipl summary on the subject (similar to PDL mapping)
        try {
          const piplPhones = Array.isArray(phones) ? phones : [];
          const piplEmails = Array.isArray(emails) ? emails : [];
          const piplAddresses = Array.isArray(addresses)
            ? addresses.map((a: any) => (typeof a === 'string' ? a : (a?.display || a?.street || [a?.line1, a?.city, a?.state, a?.postal_code || a?.zip].filter(Boolean).join(', '))))
            : [];
          (subject as any).pipl = { asOf: new Date().toISOString(), matchScore, phones: piplPhones, emails: piplEmails, addresses: piplAddresses };
          await subject.save();
        } catch {}
      } catch {}
      // relationships to related_parties
      let upserts = 0;
      const familyTerms = ['mother','father','sister','brother','spouse','wife','husband','son','daughter','parent','sibling','relative','cousin','aunt','uncle','grandmother','grandfather'];
      const toTitle = (s: string) => s ? (s.charAt(0).toUpperCase() + s.slice(1)) : s;
      const subjectCity = String((subject as any)?.city || '').trim() || null;
      // Precompute subject last name (for heuristic when provider doesn't label family)
      const getSubjectLast = () => {
        const ln = String(((subject as any)?.last_name || '')).trim();
        if (ln) return ln;
        const nm = String(((subject as any)?.name || '')).trim();
        if (nm) {
          const parts = nm.split(/\s+/).filter(Boolean);
          return parts[parts.length - 1] || '';
        }
        return '';
      };
      const subjLastRaw = String(getSubjectLast().toLowerCase().trim());
      const normalizeLast = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
      const subjLastNorm = subjLastRaw ? normalizeLast(subjLastRaw) : '';
      for (const r of relationships.slice(0, 10)) {
        try {
          const relRaw = String((r && (r['@type'] || r.type || r.relation)) || '').toLowerCase();
          const relationType = relRaw === 'household' ? 'household' : (familyTerms.some(t => relRaw.includes(t)) ? 'family' : 'associate');
          const relationLabel = (r && (r.type || r.relation || r['@type'])) ? String(r.type || r.relation || r['@type']) : null;
          // Extract any embedded contacts/addresses for the relationship if present
          const phonesR = Array.isArray((r as any)?.phones) ? (r as any).phones.map((x: any)=> x?.display_international || x?.number || String(x)).filter(Boolean) : [];
          const emailsR = Array.isArray((r as any)?.emails) ? (r as any).emails.map((e: any)=> e?.address || String(e)).filter(Boolean) : [];
          const addressesR = Array.isArray((r as any)?.addresses)
            ? (r as any).addresses.map((a: any)=> a?.display || [a?.street, a?.city, a?.state, a?.postal_code || a?.zip, a?.country].filter(Boolean).join(', ')).filter(Boolean)
            : [];
          // Relationships can include multiple names; upsert for each unique display
          const namesArr = Array.isArray((r as any)?.names) && (r as any).names.length
            ? (r as any).names
            : (r?.name ? [{ display: r.name }] : []);
          const seenNames = new Set<string>();
          for (const n of namesArr) {
            const nameRel = n?.display || [n?.first, n?.middle, n?.last].filter(Boolean).join(' ').trim();
            const nameClean = String(nameRel || '').trim();
            if (!nameClean || seenNames.has(nameClean)) continue;
            seenNames.add(nameClean);
            // Heuristic: if last name matches subject's last name (with simple normalization), treat as family when label missing
            let relTypeFinal = relationType;
            let relLabelFinal = relationLabel;
            if (!relLabelFinal && subjLastNorm) {
              const parts = nameClean.split(/\s+/);
              const last = parts[parts.length - 1] || '';
              const lastNorm = normalizeLast(last);
              if (lastNorm && lastNorm === subjLastNorm) {
                relTypeFinal = 'family';
                relLabelFinal = 'family';
              }
            }
            const pid = buildPartyId(nameClean, subjectCity, null);
            await RelatedPartyModel.updateOne(
              { subjectId: String(subjectId), $or: [ { partyId: pid }, { name: nameClean } ] },
              {
                $setOnInsert: { partyId: pid, name: nameClean },
                $set: { relationType: relTypeFinal, relationLabel: relLabelFinal ? toTitle(String(relLabelFinal)) : undefined, confidence: relTypeFinal==='family'?0.85:(relTypeFinal==='household'?0.7:0.6) },
                $addToSet: {
                  sources: 'pipl',
                  'contacts.phones': { $each: Array.from(new Set(phonesR)) },
                  'contacts.emails': { $each: Array.from(new Set(emailsR)) },
                  addresses: { $each: Array.from(new Set(addressesR)) },
                },
                $push: { audits: { at: new Date(), step: 'pipl_first_pull', provider: 'pipl', personsCount: Array.isArray(body?.possible_persons)? body.possible_persons.length : (body?.person?1:0), match: matchScore || 0, accepted: true, acceptance: 'SCORE', matchMin: 0, requireUnique: false, lastNameAgrees: null } }
              },
              { upsert: true }
            );
            upserts++;
          }
        } catch {}
      }
  const candidateName = [pf, pl].filter(Boolean).join(' ').trim() || null;
  return res.json({ ok: true, subjectId: String(subjectId), candidateName, request: { person: pPerson }, matchScore, chosenSummary: { phones, emails, addresses }, relationshipsFound: relationships.length, relatedPartiesUpserted: upserts });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/enrichment/related_party_override { subjectId, partyId?: string, name?: string, relationType?: 'family'|'household'|'associate'|'unknown', relationLabel?: string, confidence?: number }
  // Small administrative helper to correct relationship classification for specific parties
  router.post('/enrichment/related_party_override', async (req: any, res: any) => {
    try {
      const { subjectId, partyId, name, relationType, relationLabel, confidence } = req.body || {};
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      if (!partyId && !name) return res.status(400).json({ ok: false, error: 'MISSING_PARTY_SELECTOR' });
      const q: any = { subjectId: String(subjectId) };
      if (partyId) q.partyId = String(partyId);
      if (name && !partyId) q.name = String(name);
      const patch: any = {};
      if (relationType) patch.relationType = relationType;
      if (relationLabel != null) patch.relationLabel = String(relationLabel);
      if (typeof confidence === 'number') patch.confidence = confidence;
      if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'NO_FIELDS_TO_UPDATE' });
      const r = await RelatedPartyModel.updateOne(q, { $set: patch });
      return res.json({ ok: true, matched: r.matchedCount || (r as any).nMatched || 0, modified: r.modifiedCount || (r as any).nModified || 0 });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/enrichment/dob_sweep { windowHours?, minBond?, limit?, suffix? }
  // Enqueue DOB-only jobs for recent inmates to backfill DOBs and improve Prospects.
  router.post('/enrichment/dob_sweep', async (req: any, res: any) => {
    try {
      const windowHours = Math.max(1, Math.min(168, Number(req.body.windowHours || 24)));
      const minBond = Number(req.body.minBond != null ? req.body.minBond : 500);
      const limit = Math.max(1, Math.min(1000, Number(req.body.limit || 200)));
      const suffix = String(req.body.suffix || Math.floor(Date.now() / 1000));
      const sinceIdem = new Date(Date.now() - (config.idempotencyWindowSeconds || 600) * 1000);
      const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
      const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
      function parseTs(v: any): Date | null {
        if (v == null) return null;
        if (v instanceof Date && !isNaN(v.getTime())) return v;
        if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
        if (typeof v === 'string') {
          const s = v.trim(); if (!s) return null; const d0 = new Date(s); if (!isNaN(d0.getTime())) return d0;
          if (/^\d{10,13}$/.test(s)) { const n = Number(s); return new Date(s.length === 13 ? n : n * 1000); }
        }
        return null;
      }
      function bestBooking(doc: any): Date | null {
        for (const f of bookingFields) { if (Object.prototype.hasOwnProperty.call(doc, f)) { const d = parseTs((doc as any)[f]); if (d && !isNaN(d.getTime())) return d; } }
        return null;
      }
      // Pull a large window and filter in memory for booking cutoff & bond
      const docs = await InmateModel.find({}, { spn:1, subject_id:1, subjectId:1, dob:1, hcso_status:1, bond:1, bond_amount:1, booking_datetime:1, booking_at:1, booking_time:1, booking_date:1 })
        .sort({ _id: -1 })
        .limit(50000)
        .lean();
      let candidates = docs.filter((d: any) => {
        const bAt = bestBooking(d); if (!bAt || bAt < cutoff) return false;
        if (d?.hcso_status?.notInJail) return false;
        const dobMissing = d.dob == null || String(d.dob).trim() === '';
        if (!dobMissing) return false;
        const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : 0);
        return bondVal >= minBond;
      });
      candidates = candidates.slice(0, limit);
      // Idempotency: skip those with a recent SUCCEEDED job or currently active
      const subjectIds = candidates.map((d: any) => String(d.spn || d.subject_id || d.subjectId)).filter(Boolean);
      const recentSucceeded = await EnrichmentJobModel.find({ subjectId: { $in: subjectIds }, status: 'SUCCEEDED', updatedAt: { $gte: sinceIdem } }, { subjectId:1 }).lean();
      const active = await EnrichmentJobModel.find({ subjectId: { $in: subjectIds }, status: { $in: ['NEW','READY','RUNNING'] } }, { subjectId:1 }).lean();
      const skipSet = new Set<string>([...recentSucceeded.map((x: any)=>String(x.subjectId)), ...active.map((x: any)=>String(x.subjectId))]);
      let enqueued = 0; const jobIds: string[] = [];
      for (const d of candidates) {
        const sid = String(d.spn || d.subject_id || d.subjectId);
        if (!sid || skipSet.has(sid)) continue;
        const jobIdStr = `${sid}_dob-only_${suffix}`;
        const job = await queue.add('enrich', { subjectId: sid, mode: 'dob-only' as const }, { removeOnComplete: true, removeOnFail: false, jobId: jobIdStr });
        await EnrichmentJobModel.updateOne(
          { jobId: job.id },
          { $setOnInsert: { jobId: job.id, subjectId: sid, status: 'READY', steps: [], progress: 0, logs: [], errors: [], idempotencyKey: `${sid}_v1` } },
          { upsert: true }
        );
        enqueued++; jobIds.push(String(job.id));
      }
      res.json({ ok: true, enqueued, requested: candidates.length, windowHours, minBond, limit, suffix, jobIdsSample: jobIds.slice(0, 5) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /api/enrichment/demo/pick_spn?minBond=10000&maxBond=25000&city=Houston&state=TX&county=Harris
  router.get('/enrichment/demo/pick_spn', async (req: any, res: any) => {
    try {
      const minBond = Number(req.query.minBond || 10000);
      const maxBond = Number(req.query.maxBond || 25000);
      const city = String(req.query.city || 'Houston');
      const state = String(req.query.state || 'TX');
      const county = String(req.query.county || 'Harris');
      const filter: any = {
        $and: [
          { $expr: { $gte: [ { $ifNull: ['$bond_amount', { $ifNull: ['$bond', 0] }] }, minBond ] } },
          { $expr: { $lte: [ { $ifNull: ['$bond_amount', { $ifNull: ['$bond', 0] }] }, maxBond ] } },
        ],
        'hcso_status.notInJail': { $ne: true },
      };
      // optional location constraints
      if (city) filter.city = new RegExp(`^${city}$`, 'i');
      if (state) filter.state = new RegExp(`^${state}$`, 'i');
      if (county) filter.county = new RegExp(`^${county}$`, 'i');
      // prefer subjects with DOB present
      const docs = await InmateModel.find(filter, { spn:1, subject_id:1, subjectId:1, first_name:1, last_name:1, dob:1, city:1, state:1, county:1, bond:1, bond_amount:1 })
        .sort({ bond_amount: -1, bond: -1, _id: -1 })
        .limit(50)
        .lean();
      if (!docs.length) return res.json({ ok: false, reason: 'NO_CANDIDATES' });
      const withDob = docs.filter((d: any) => d.dob != null && String(d.dob).trim() !== '');
      const chosen = (withDob[0] || docs[0]);
      const bondVal = typeof chosen.bond_amount === 'number' ? chosen.bond_amount : (typeof chosen.bond === 'number' ? chosen.bond : null);
      const subjectId = String(chosen.spn || chosen.subject_id || chosen.subjectId);
      return res.json({ ok: true, subjectId, bond: bondVal, dob: chosen.dob || null, city: chosen.city || null, state: chosen.state || null, county: chosen.county || null });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/enrichment/pdl_first_pull { subjectId?: string, overrideLocation?: boolean }
  // Runs a single PDL enrich pull for the subject, biases to Houston, TX, US, picks best match, and extracts relationships
  router.post('/enrichment/pdl_first_pull', async (req: any, res: any) => {
    try {
      if (!config.pdlApiKey || !(config as any).providerPdlEnabled) {
        return res.status(400).json({ ok: false, error: 'PDL_DISABLED_OR_MISSING_KEY' });
      }
  let { subjectId, overrideLocation, allowDemo } = req.body as { subjectId?: string; overrideLocation?: boolean; allowDemo?: boolean };
      if (!subjectId) {
        // pick a candidate using defaults if not provided
        const pick = await (async () => {
          const minBond = 10000, maxBond = 25000;
          const filter: any = {
            $and: [
              { $expr: { $gte: [ { $ifNull: ['$bond_amount', { $ifNull: ['$bond', 0] }] }, minBond ] } },
              { $expr: { $lte: [ { $ifNull: ['$bond_amount', { $ifNull: ['$bond', 0] }] }, maxBond ] } },
            ],
            'hcso_status.notInJail': { $ne: true },
            city: /^Houston$/i,
            state: /^TX$/i,
            county: /^Harris$/i,
          };
          const d = await InmateModel.find(filter, { spn:1, subject_id:1, subjectId:1 }).sort({ bond_amount: -1, bond: -1, _id: -1 }).limit(1).lean();
          return d[0];
        })();
        if (!pick) return res.status(404).json({ ok: false, error: 'NO_SUBJECT_FOUND' });
        subjectId = String((pick as any).spn || (pick as any).subject_id || (pick as any).subjectId);
      }
      const subject = await InmateModel.findOne({ $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] });
      if (!subject) return res.status(404).json({ ok: false, error: 'SUBJECT_NOT_FOUND' });
      const first = (subject as any).first_name || '';
      const last = (subject as any).last_name || '';
      const dob = (subject as any).dob || undefined;
      const city = overrideLocation ? 'Houston' : ((subject as any).city || 'Houston');
      const state = overrideLocation ? 'TX' : ((subject as any).state || 'TX');
      const location = `${city}, ${state}, US`;
      const name = `${first} ${last}`.trim();
      const url = new URL('https://api.peopledatalabs.com/v5/person/enrich');
      if (name) url.searchParams.set('name', name);
      if (location) url.searchParams.set('location', location);
      if (dob) url.searchParams.set('dob', String(dob));
  // Add api_key query in addition to header to avoid any header parsing issues upstream
  if (config.pdlApiKey) url.searchParams.set('api_key', config.pdlApiKey);
      const resp = await fetch(url.toString(), { headers: { 'X-API-Key': config.pdlApiKey! }, method: 'GET' } as any);
      let body: any = null;
      if (!resp.ok) {
        let errTxt: string | null = null;
        try { errTxt = await resp.text(); } catch {}
        if (allowDemo) {
          // Demo fallback payload (structure similar to pdlClient mock)
          body = { matches: [
            { '@match': 0.88, phones: ['+1 (713) 555-1010'], emails: ['example@example.com'], addresses: [{ street: '456 Oak St, Houston, TX' }], usernames: ['houston_contact'], user_ids: ['tw:987'],
              relationships: [ { name: 'Jane Doe', type: 'Spouse' }, { name: 'Mike Doe', type: 'Brother' } ] },
            { '@match': 0.64, phones: ['+1 (832) 555-2020'] }
          ] };
        } else {
          return res.status(500).json({ ok: false, error: `PDL_HTTP_${resp.status}`, providerMessage: errTxt ? String(errTxt).slice(0, 500) : null });
        }
      } else {
        body = await resp.json();
      }
  // Normalize to matches array like worker client
  const matches: any[] = Array.isArray(body?.matches) ? body.matches : (body?.data ? [body.data] : []);
      let chosen: any = null; let matchScore = 0;
      for (const c of matches) {
        const m = typeof c['@match'] === 'number' ? c['@match'] : 0;
        if (m > matchScore) { matchScore = m; chosen = c; }
      }
      // persist raw
      try {
        await RawProviderPayloadModel.create({ provider: 'pdl', subjectId: String(subjectId), step: 'pdl_first_pull', payload: { request: { name, location, dob }, response: body, bestScore: matchScore }, ttlExpiresAt: new Date(Date.now() + (config as any).rawPayloadTtlHours * 3600 * 1000) });
      } catch {}
      // update subject minimal mapping & facts
      if (chosen) {
        try {
          const phones = Array.isArray(chosen?.phones) ? chosen.phones : [];
          const emails = Array.isArray(chosen?.emails) ? chosen.emails : [];
          const addresses = Array.isArray(chosen?.addresses) ? chosen.addresses : [];
          const usernames = Array.isArray(chosen?.usernames) ? chosen.usernames : [];
          const user_ids = Array.isArray(chosen?.user_ids) ? chosen.user_ids : [];
          subject.set('pdl', { asOf: new Date().toISOString(), matchScore, phones, emails, addresses, usernames, user_ids });
          const facts = subject.get('facts') || {};
          facts.phones = Array.from(new Set([...(facts.phones || []), ...phones]));
          facts.emails = Array.from(new Set([...(facts.emails || []), ...emails]));
          facts.addresses = Array.from(new Set([...(facts.addresses || []), ...addresses.map((a: any) => a?.street || a)]));
          facts.usernames = Array.from(new Set([...(facts.usernames || []), ...usernames]));
          facts.user_ids = Array.from(new Set([...(facts.user_ids || []), ...user_ids]));
          subject.set('facts', facts);
          await subject.save();
        } catch {}
      }
      // extract relationships to related_parties
      const relations: any[] = [];
      const relSrc = (chosen && (chosen.relationships || chosen.relatives || chosen.family_members)) || [];
      if (Array.isArray(relSrc)) {
        for (const r of relSrc) {
          if (!r) continue;
          if (typeof r === 'string') { relations.push({ name: r, relation: 'associate' }); continue; }
          const name = r.name || r.full_name || r.first_name && r.last_name ? `${r.first_name||''} ${r.last_name||''}`.trim() : null;
          const relation = r.type || r.relation || r.relationship || 'associate';
          if (name) relations.push({ name, relation });
        }
      }
      let upserts = 0;
      const sid = String(subjectId);
      for (const r of relations.slice(0, 10)) { // cap to 10
        try {
          const rel = String(r.relation || '').toLowerCase();
          const familyTerms = ['mother','father','sister','brother','spouse','wife','husband','son','daughter','parent','sibling','relative','cousin','aunt','uncle','grandmother','grandfather'];
          const relationType = familyTerms.some(t => rel.includes(t)) ? 'family' : 'associate';
          await RelatedPartyModel.updateOne(
            { subjectId: sid, partyId: `${r.name}|${relationType}` },
            { $set: { name: r.name, relationType, confidence: relationType==='family'?0.8:0.6 }, $addToSet: { sources: 'pdl' } },
            { upsert: true }
          );
          upserts++;
        } catch {}
      }
  const candidateName = name || null;
  return res.json({ ok: true, subjectId: sid, candidateName, request: { name, location, dob }, matchScore, chosenSummary: chosen ? { phones: chosen.phones||[], emails: chosen.emails||[], addresses: chosen.addresses||[], usernames: chosen.usernames||[], user_ids: chosen.user_ids||[] } : null, relationshipsFound: relations.length, relatedPartiesUpserted: upserts });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /api/enrichment/related_parties?subjectId=... -> list extracted relationships
  router.get('/enrichment/related_parties', async (req: any, res: any) => {
    try {
      const subjectId = String(req.query.subjectId || '').trim();
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      const rowsRaw = await RelatedPartyModel.find(
        { subjectId: subjectId },
        {
          _id: 0,
          subjectId: 1,
          partyId: 1,
          name: 1,
          relationType: 1,
          confidence: 1,
          sources: 1,
          createdAt: 1,
          updatedAt: 1,
          audits: 1,
          // Include contact fields for UI counts and details
          'contacts.phones': 1,
          'contacts.emails': 1,
          addresses: 1,
        }
      )
        .sort({ updatedAt: -1 })
        .limit(100)
        .lean();
      const getSubjLastFor = async (sid: string) => {
        try {
          const subj = await InmateModel.findOne({ $or: [ { spn: sid }, { subject_id: sid }, { subjectId: sid } ] }, { last_name: 1, name: 1 }).lean();
          const ln = String((subj as any)?.last_name || '').trim();
          if (ln) return ln;
          const nm = String((subj as any)?.name || '').trim();
          if (nm) { const parts = nm.split(/\s+/).filter(Boolean); return parts[parts.length-1]||''; }
        } catch {}
        return '';
      };
      const norm = (s: string) => String(s||'').toLowerCase().replace(/[^a-z]/g,'').replace(/(.)\1+/g,'$1');
      const subjLastNorm = norm(await getSubjLastFor(subjectId));
      const rows = rowsRaw.map((p: any) => {
        const audits = Array.isArray(p.audits) ? p.audits : [];
        const lastAudit = audits.length ? audits[audits.length - 1] : null;
  const auditLite = lastAudit ? { at: lastAudit.at, provider: lastAudit.provider, personsCount: lastAudit.personsCount, match: normalizeMatch((lastAudit as any).match), accepted: lastAudit.accepted, acceptance: lastAudit.acceptance, lastNameAgrees: lastAudit.lastNameAgrees, matchMin: lastAudit.matchMin, requireUnique: lastAudit.requireUnique, gainedData: (lastAudit as any).gainedData ?? null, netNewPhones: (lastAudit as any).netNewPhones ?? null, netNewEmails: (lastAudit as any).netNewEmails ?? null, netNewAddresses: (lastAudit as any).netNewAddresses ?? null } : null;
        const lastTargeted = audits.filter((a: any) => a && a.targeted === true).pop() || null;
        const lastTargetedAt = lastTargeted?.at ? new Date(lastTargeted.at) : null;
        const cooldownEndsAt = (lastTargetedAt && PARTY_PULL_COOLDOWN_MINUTES)
          ? new Date(lastTargetedAt.getTime() + PARTY_PULL_COOLDOWN_MINUTES * 60 * 1000)
          : null;
        const phones = Array.isArray((p as any)?.contacts?.phones) ? (p as any).contacts.phones : [];
        const emails = Array.isArray((p as any)?.contacts?.emails) ? (p as any).contacts.emails : [];
        const addresses = Array.isArray((p as any)?.addresses) ? (p as any).addresses : [];
        let relationType = p.relationType;
        let relationLabel = (p as any).relationLabel || null;
        if ((!relationLabel || relationLabel.toLowerCase() === 'associate') && subjLastNorm && p?.name) {
          const parts = String(p.name).split(/\s+/); const last = parts[parts.length-1]||'';
          if (norm(last) === subjLastNorm) { relationType = 'family'; relationLabel = relationLabel || 'family'; }
        }
        return {
          subjectId: p.subjectId,
          partyId: p.partyId,
          name: p.name,
          relationType,
          relationLabel,
          confidence: p.confidence,
          sources: p.sources,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          lastAudit: auditLite,
          lastTargetedAt,
          cooldownEndsAt,
          contacts: { phones, emails },
          addresses,
        };
      });
      res.json({ ok: true, count: rows.length, rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/enrichment/related_party_pull { subjectId, maxParties?: 3, requireUnique?: true, matchMin?: 0.85, partyId?: string, partyName?: string, aggressive?: boolean, preferStatewide?: boolean, force?: boolean }
  // For the subject's related parties, query Pipl by name + city/state and upsert phones/emails/addresses into related_parties
  router.post('/enrichment/related_party_pull', async (req: any, res: any) => {
    try {
      if (!(config as any).piplApiKey || !(config as any).providerPiplEnabled) return res.status(400).json({ ok: false, error: 'PIPL_DISABLED_OR_MISSING_KEY' });
  const { subjectId, maxParties = 3, requireUnique = true, matchMin = DEFAULT_MATCH_MIN, partyId, partyName, aggressive = false, preferStatewide: preferStatewideRaw, force: forceRaw } = req.body || {};
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      const subject = await InmateModel.findOne({ $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] }, { city: 1, state: 1 }).lean();
      if (!subject) return res.status(404).json({ ok: false, error: 'SUBJECT_NOT_FOUND' });
  const city = String((subject as any).city || 'Katy');
      const state = String((subject as any).state || 'TX');
  const hasCity = !!(subject as any).city && String((subject as any).city).trim().length > 0;
      // pick related parties lacking contacts first
  const parties = await RelatedPartyModel.find({ subjectId: String(subjectId) }, { name: 1, relationType: 1, confidence: 1, contacts: 1, partyId: 1, audits: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).limit(20).lean();
      const need = parties.filter((p: any) => !p?.contacts || ((!Array.isArray(p.contacts.phones) || p.contacts.phones.length === 0) && (!Array.isArray(p.contacts.emails) || p.contacts.emails.length === 0)));
      // If a target party is specified, restrict to just that party
      const targeted = !!(partyId || partyName);
      let pool = (need.length ? need : parties);
      if (targeted) {
        const pid = partyId ? String(partyId) : '';
        const pnm = partyName ? String(partyName).toLowerCase().trim() : '';
        pool = pool.filter((p: any) => {
          const matchesId = pid && String((p as any).partyId || '') === pid;
          const matchesName = pnm && String((p as any).name || '').toLowerCase().trim() === pnm;
          return matchesId || matchesName;
        });
        // If nothing matches the target, return early with a benign response
        if (!pool.length) {
          return res.json({ ok: true, subjectId: String(subjectId), city, state, targeted: true, tried: 0, updated: 0, skipped: 0, details: [{ target: { partyId: pid || null, partyName: pnm || null }, reason: 'TARGET_NOT_FOUND' }] });
        }
      }
  // Cooldown to avoid repeated enrich of the same party within a small window (can be bypassed when force=true)
  const cooldownMinutes = PARTY_PULL_COOLDOWN_MINUTES;
      const force = String(forceRaw ?? 'false').toLowerCase() === 'true';
      const cutoff = cooldownMinutes ? new Date(Date.now() - cooldownMinutes * 60 * 1000) : null;
      // If targeted and the last targeted audit is within cooldown, skip before calling provider
      if (targeted && cutoff && !force) {
        const c = pool[0];
        const audits = Array.isArray((c as any).audits) ? (c as any).audits : [];
        const last = audits.length ? audits[audits.length - 1] : null;
        const lastAt = last?.at ? new Date(last.at) : null;
        const lastWasTargeted = last?.targeted === true;
        if (lastAt && lastAt >= cutoff && lastWasTargeted) {
          const nextEligibleAt = new Date(lastAt.getTime() + cooldownMinutes * 60 * 1000);
          return res.json({ ok: true, subjectId: String(subjectId), city, state, targeted: true, tried: 0, updated: 0, skipped: 1, cooldownActive: true, cooldownMinutes, lastTargetedAt: lastAt, nextEligibleAt, details: [{ partyId: (c as any).partyId || null, name: (c as any).name || null, reason: 'COOLDOWN_ACTIVE' }] });
        }
      }
      const candidates = pool.slice(0, Math.max(1, Math.min(10, Number(maxParties))));
      let tried = 0, updated = 0, skipped = 0;
      const details: any[] = [];
      function splitName(n: string){
        const parts = String(n||'').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 1) return { first: parts[0], last: '' };
        if (parts.length === 2) return { first: parts[0], last: parts[1] };
        return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
      }
      for (const p of candidates) {
        // Per-party cooldown check when not strictly targeted early-returned
        if (cutoff && !force) {
          const audits = Array.isArray((p as any).audits) ? (p as any).audits : [];
          const last = audits.length ? audits[audits.length - 1] : null;
          const lastAt = last?.at ? new Date(last.at) : null;
          const lastWasTargeted = last?.targeted === true;
          if (lastAt && lastAt >= cutoff && lastWasTargeted) {
            skipped++;
            details.push({ partyId: (p as any).partyId || null, name: (p as any).name || null, reason: 'COOLDOWN_ACTIVE' });
            continue;
          }
        }
        tried++;
        const nm = String(p.name || '').trim();
        if (!nm) { skipped++; details.push({ name: nm, reason: 'EMPTY_NAME' }); continue; }
        const { first, last } = splitName(nm);
        // Attempt 1: smart-first
        // - If request explicitly sets preferStatewide, honor it
        // - Else if config.partyPullPreferStatewide is true, use state-only
        // - Else if city is present (not fallback), use city+state
        // - Else (no reliable city), use state-only
        const preferStatewide = (typeof preferStatewideRaw === 'boolean')
          ? preferStatewideRaw
          : ( (config as any).partyPullPreferStatewide || !hasCity );
        const personCity: any = preferStatewide
          ? { names: [{ first, last }], addresses: [{ state, country: 'US' }] }
          : { names: [{ first, last }], addresses: [{ city, state, country: 'US' }] };
        const bodyReq1 = { key: (config as any).piplApiKey, person: personCity };
        let data: any = null; let httpStatus = 0; let attempt = 1;
        try {
          const r = await fetch('https://api.pipl.com/search/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyReq1) } as any);
          httpStatus = r.status;
          const t = await r.text();
          try { data = JSON.parse(t); } catch { data = {}; }
          await RawProviderPayloadModel.create({ provider: 'pipl', subjectId: String(subjectId), step: 'pipl_party_pull', payload: { request: { subjectId, name: nm, person: personCity, attempt }, response: data }, ttlExpiresAt: new Date(Date.now() + (config as any).rawPayloadTtlHours * 3600 * 1000) });
        } catch (e: any) {
          details.push({ name: nm, error: String(e) }); skipped++; continue;
        }
        let personsCount = Number(data?.['@persons_count'] || 0);
        // Only attempt fallbacks when aggressive=true to avoid multiple chargeable calls per click
        if (!personsCount && aggressive) {
          attempt = 2;
          // If first was city+state, try state-only; if first was already state-only, skip to simplified-first
          if (!preferStatewide) {
            const personState: any = { names: [{ first, last }], addresses: [{ state, country: 'US' }] };
            const bodyReq2 = { key: (config as any).piplApiKey, person: personState };
            try {
              const r2 = await fetch('https://api.pipl.com/search/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyReq2) } as any);
              httpStatus = r2.status;
              const t2 = await r2.text();
              let data2: any = {};
              try { data2 = JSON.parse(t2); } catch { data2 = {}; }
              await RawProviderPayloadModel.create({ provider: 'pipl', subjectId: String(subjectId), step: 'pipl_party_pull', payload: { request: { subjectId, name: nm, person: personState, attempt }, response: data2 }, ttlExpiresAt: new Date(Date.now() + (config as any).rawPayloadTtlHours * 3600 * 1000) });
              const pc2 = Number(data2?.['@persons_count'] || 0);
              if (pc2) { data = data2; personsCount = pc2; }
            } catch (e: any) {}
          }
        }
        if (!personsCount && aggressive) {
          attempt = 3;
          const firstSimple = String(first || '').split(/\s+/).filter(Boolean)[0] || String(first || '');
          const personSimple: any = { names: [{ first: firstSimple, last }], addresses: [{ state, country: 'US' }] };
          const bodyReq3 = { key: (config as any).piplApiKey, person: personSimple };
          try {
            const r3 = await fetch('https://api.pipl.com/search/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyReq3) } as any);
            httpStatus = r3.status;
            const t3 = await r3.text();
            let data3: any = {};
            try { data3 = JSON.parse(t3); } catch { data3 = {}; }
            await RawProviderPayloadModel.create({ provider: 'pipl', subjectId: String(subjectId), step: 'pipl_party_pull', payload: { request: { subjectId, name: nm, person: personSimple, attempt }, response: data3 }, ttlExpiresAt: new Date(Date.now() + (config as any).rawPayloadTtlHours * 3600 * 1000) });
            const pc3 = Number(data3?.['@persons_count'] || 0);
            if (pc3) { data = data3; personsCount = pc3; }
          } catch (e: any) {}
        }
        // Normalize a "best match"
        const extract = (pp: any) => {
          const m = typeof pp?.['@match'] === 'number' ? pp['@match'] : (typeof data?.['@match'] === 'number' ? data['@match'] : 0.0);
          const phones = Array.isArray(pp?.phones) ? pp.phones.map((x: any)=> x?.display_international || x?.number || x) : [];
          const emails = Array.isArray(pp?.emails) ? pp.emails.map((e: any)=> e?.address || e) : [];
          const addresses = Array.isArray(pp?.addresses) ? pp.addresses.map((a: any)=> a?.display || [a?.street, a?.city, a?.state, a?.postal_code || a?.zip, a?.country].filter(Boolean).join(', ')) : [];
          const lastName = (Array.isArray(pp?.names) && pp.names[0]?.last) ? String(pp.names[0].last) : '';
          return { m, phones, emails, addresses, lastName };
        };
        let matches: any[] = [];
        if (Array.isArray(data?.possible_persons) && data.possible_persons.length) {
          matches = data.possible_persons.map((pp: any)=> extract(pp));
        } else if (data?.person) {
          matches = [extract(data.person)];
        }
        // choose best and apply stricter acceptance
        let best = matches.sort((a,b)=> (b.m||0) - (a.m||0))[0] || null;
        const lastOk = best && last && best.lastName && String(best.lastName).toLowerCase() === String(last).toLowerCase();
        const acceptByScore = best && (best.m || 0) >= Number(matchMin);
        const acceptByUniq = (requireUnique && personsCount === 1 && best && (best.m || 0) >= Math.max(0.6, Number(matchMin) - 0.1));
        const accepted = (!!best) && ((acceptByScore || acceptByUniq) && (last ? lastOk : true));
        const acceptance = accepted ? (acceptByScore ? 'SCORE' : 'UNIQUE') : 'REJECT';
        // Write audit entry regardless of acceptance
        try {
          await RelatedPartyModel.updateOne(
            { subjectId: String(subjectId), $or: [ { partyId: String((p as any).partyId || '') }, { name: nm } ] },
            { $setOnInsert: { partyId: (p as any).partyId || buildPartyId(nm, city, null), name: nm },
              $push: { audits: { at: new Date(), step: 'pipl_party_pull', provider: 'pipl', personsCount, match: best?.m || 0, accepted, acceptance, matchMin: Number(matchMin), requireUnique: !!requireUnique, lastNameAgrees: !!lastOk, queriedName: nm, city, state, targeted, preferStatewide: !!(typeof preferStatewideRaw === 'boolean' ? preferStatewideRaw : ((config as any).partyPullPreferStatewide || !hasCity)), forced: !!force } } },
            { upsert: true }
          );
        } catch {}
        if (!accepted) {
          skipped++;
          details.push({ partyId: (p as any).partyId || null, name: nm, personsCount, match: best?.m || 0, accepted: false });
          continue;
        }
        // Upsert contacts/addresses to related_parties with value gate (net new data)
        try {
          const phonesU = Array.from(new Set((best.phones||[]).map((x: any)=> String(x).trim()).filter(Boolean))).slice(0, 10) as string[];
          const emailsU = Array.from(new Set((best.emails||[]).map((x: any)=> String(x).trim()).filter(Boolean))).slice(0, 10) as string[];
          // Filter out trivial country-only addresses
          const isTrivialAddr = (s: string) => /^(united\s*states|usa|u\.?s\.?)$/i.test(s.trim());
          const addrsU = Array.from(new Set((best.addresses||[]).map((x: any)=> String(x).trim()).filter(Boolean).filter((s: string)=> !isTrivialAddr(s)))).slice(0, 10) as string[];
          const pid = buildPartyId(nm, (subject as any)?.city || null, null);
          // Compute net new by comparing with current stored values
          const existing = await RelatedPartyModel.findOne({ subjectId: String(subjectId), $or: [ { partyId: pid }, { name: nm } ] }, { 'contacts.phones': 1, 'contacts.emails': 1, addresses: 1 }).lean();
          const existingPhones = new Set<string>(Array.isArray((existing as any)?.contacts?.phones) ? (existing as any).contacts.phones.map((s: any)=> String(s)) : []);
          const existingEmails = new Set<string>(Array.isArray((existing as any)?.contacts?.emails) ? (existing as any).contacts.emails.map((s: any)=> String(s)) : []);
          const existingAddresses = new Set<string>(Array.isArray((existing as any)?.addresses) ? (existing as any).addresses.map((s: any)=> String(s)) : []);
          const netPhones = phonesU.filter((v) => !existingPhones.has(v));
          const netEmails = emailsU.filter((v) => !existingEmails.has(v));
          const netAddrs = addrsU.filter((v) => !existingAddresses.has(v));
          const gainedData = (netPhones.length + netEmails.length + netAddrs.length) > 0;
          await RelatedPartyModel.updateOne(
            { subjectId: String(subjectId), $or: [ { partyId: pid }, { name: nm } ] },
            { $setOnInsert: { partyId: pid, name: nm },
              $addToSet: { sources: 'pipl', 'contacts.phones': { $each: netPhones }, 'contacts.emails': { $each: netEmails }, addresses: { $each: netAddrs } },
              $push: { audits: { at: new Date(), step: 'pipl_party_pull', provider: 'pipl', personsCount, match: best.m || 0, accepted: true, acceptance: (acceptByScore?'SCORE':'UNIQUE'), matchMin: Number(matchMin), requireUnique: !!requireUnique, lastNameAgrees: !!lastOk, queriedName: nm, city, state, targeted, preferStatewide: !!(typeof preferStatewideRaw === 'boolean' ? preferStatewideRaw : ((config as any).partyPullPreferStatewide || !hasCity)), forced: !!force, gainedData, netNewPhones: netPhones.length, netNewEmails: netEmails.length, netNewAddresses: netAddrs.length } } },
            { upsert: true }
          );
          updated++;
          details.push({ partyId: (p as any).partyId || pid, name: nm, accepted: true, personsCount, match: best.m || 0, netNew: { phones: netPhones.length, emails: netEmails.length, addresses: netAddrs.length }, gainedData });
        } catch (e: any) {
          details.push({ partyId: (p as any).partyId || null, name: nm, error: String(e) }); skipped++; continue;
        }
      }
  res.json({ ok: true, subjectId: String(subjectId), city, state, targeted, tried, updated, skipped, details, cooldownMinutes, forced: !!force })
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/enrichment/related_party_sweep { subjectIds?: string[], windowHours?: 48, maxSubjects?: 5, maxParties?: 3, requireUnique?: true, matchMin?: 0.85 }
  // Repeat run: find subjects with related parties lacking contacts and enrich via Pipl, with conservative caps
  router.post('/enrichment/related_party_sweep', async (req: any, res: any) => {
    try {
      if (!(config as any).piplApiKey || !(config as any).providerPiplEnabled) return res.status(400).json({ ok: false, error: 'PIPL_DISABLED_OR_MISSING_KEY' });
      const subjectIds: string[] = Array.isArray(req.body?.subjectIds) ? req.body.subjectIds.map((x: any)=> String(x)) : [];
      const windowHours = Math.max(1, Math.min(168, Number(req.body?.windowHours || 48)));
      const maxSubjects = Math.max(1, Math.min(25, Number(req.body?.maxSubjects || 5)));
      const maxParties = Math.max(1, Math.min(10, Number(req.body?.maxParties || 3)));
      const requireUnique = String(req.body?.requireUnique ?? 'true').toLowerCase() === 'true';
  const matchMin = Number(req.body?.matchMin ?? DEFAULT_MATCH_MIN);
      // Build subject list
      let targets: string[] = [];
      if (subjectIds.length) {
        targets = subjectIds.slice(0, maxSubjects);
      } else {
        const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
        // Pull recent related parties updated recently, group by subject lacking contacts
        const recent = await RelatedPartyModel.find({ updatedAt: { $gte: cutoff } }, { subjectId: 1, contacts: 1 }).sort({ updatedAt: -1 }).limit(500).lean();
        const bySubject = new Map<string, number>();
        for (const r of recent) {
          const hasContact = !!(r?.contacts && ((Array.isArray((r as any).contacts?.phones) && (r as any).contacts.phones.length) || (Array.isArray((r as any).contacts?.emails) && (r as any).contacts.emails.length)));
          if (!hasContact) {
            const sid = String((r as any).subjectId);
            bySubject.set(sid, (bySubject.get(sid) || 0) + 1);
          }
        }
        targets = Array.from(bySubject.keys()).slice(0, maxSubjects);
      }
      const results: any[] = [];
      for (const sid of targets) {
        const r = await fetch('http://localhost:'+String(config.port)+'/api/enrichment/related_party_pull', { method: 'POST', headers: { 'Content-Type': 'application/json' } as any, body: JSON.stringify({ subjectId: sid, maxParties, requireUnique, matchMin }) } as any);
        const txt = await r.text();
        let obj: any = {}; try { obj = JSON.parse(txt); } catch { obj = { ok: false, http: r.status, body: txt.slice(0, 500) }; }
        results.push({ subjectId: sid, http: r.status, ok: obj?.ok === true, updated: obj?.updated || 0, skipped: obj?.skipped || 0 });
      }
      res.json({ ok: true, windowHours, maxSubjects, maxParties, requireUnique, matchMin, subjectsTried: targets.length, results });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // POST /api/enrichment/related_party_validate_phones { subjectId, maxPerParty?: 3 }
  // Uses Whitepages to validate stored phones for related parties and stores evidence
  router.post('/enrichment/related_party_validate_phones', async (req: any, res: any) => {
    try {
  const { subjectId, maxPerParty = 3 } = req.body || {};
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      if (!((config as any).providerWhitepagesEnabled && config.whitepagesApiKey)) return res.status(400).json({ ok: false, error: 'WHITEPAGES_DISABLED_OR_MISSING_KEY' });
      const parties = await RelatedPartyModel.find({ subjectId: String(subjectId) }, { name: 1, contacts: 1, partyId: 1 }).limit(50).lean();
      let tried = 0, updated = 0; const details: any[] = [];
      for (const p of parties) {
        const phones = Array.isArray((p as any)?.contacts?.phones) ? (p as any).contacts.phones.slice(0, Math.max(1, Math.min(10, Number(maxPerParty)))) : [];
        if (!phones.length) { details.push({ name: p.name, reason: 'NO_PHONES' }); continue; }
        tried += phones.length;
  const result = await whitepagesLookupLocal({ phones });
        const hits = Array.isArray(result?.data) ? result.data : [];
        let wrote = 0;
        for (let i = 0; i < hits.length; i++) {
          const h: any = hits[i];
          // Persist raw payload for admin review and auditability
          try {
            await RawProviderPayloadModel.create({
              provider: 'whitepages',
              subjectId: String(subjectId),
              step: 'whitepages_phone_lookup',
              payload: { request: { phone: String(phones[i] || '') }, response: h },
              ttlExpiresAt: new Date(Date.now() + (config as any).rawPayloadTtlHours * 3600 * 1000)
            });
          } catch {}
          try {
            await RelatedPartyModel.updateOne(
              { subjectId: String(subjectId), partyId: String((p as any).partyId) },
              { $addToSet: { evidence: { type: 'whitepages_phone', value: String(phones[i]||''), weight: 0.6, provider: 'whitepages' } } }
            );
            wrote++;
          } catch {}
        }
        if (wrote) updated++;
        details.push({ name: p.name, phonesTried: phones.length, evidenceAdded: wrote });
      }
      res.json({ ok: true, subjectId: String(subjectId), tried, partiesUpdated: updated, details });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /api/enrichment/related_party_audits?subjectId=...&partyId=...&limit=50
  // Returns audits for a subject's related parties (optionally a single party), plus a small summary
  router.get('/enrichment/related_party_audits', async (req: any, res: any) => {
    try {
      const subjectId = String(req.query.subjectId || '').trim();
      const partyId = String(req.query.partyId || '').trim();
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
      if (!subjectId) return res.status(400).json({ ok: false, error: 'MISSING_SUBJECT_ID' });
      const q: any = { subjectId };
      if (partyId) q.partyId = partyId;
      const rows = await RelatedPartyModel.find(q, { subjectId: 1, partyId: 1, name: 1, audits: 1, updatedAt: 1 })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      // flatten audits with context and compute a summary
      const audits: any[] = [];
      for (const r of rows) {
        const a = Array.isArray((r as any).audits) ? (r as any).audits : [];
        for (const ent of a) {
          audits.push({ subjectId: r.subjectId, partyId: r.partyId, name: r.name, at: ent.at, provider: ent.provider, personsCount: ent.personsCount, match: ent.match, accepted: ent.accepted, acceptance: ent.acceptance, lastNameAgrees: ent.lastNameAgrees, matchMin: ent.matchMin, requireUnique: ent.requireUnique, city: ent.city, state: ent.state, targeted: ent.targeted === true, preferStatewide: (ent as any).preferStatewide ?? null, forced: (ent as any).forced === true, gainedData: (ent as any).gainedData ?? null, netNewPhones: (ent as any).netNewPhones ?? null, netNewEmails: (ent as any).netNewEmails ?? null, netNewAddresses: (ent as any).netNewAddresses ?? null });
        }
      }
      audits.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      const accepted = audits.filter((x) => x.accepted).length;
      const rejected = audits.length - accepted;
      const lastTargetedAt = (() => {
        let t: Date | null = null;
        for (const a of audits) {
          if (a.targeted) {
            const d = new Date(a.at);
            if (!t || d > t) t = d;
          }
        }
        return t;
      })();
      const summary = { totalAudits: audits.length, accepted, rejected, acceptanceRatePct: audits.length ? Math.round((accepted / audits.length) * 1000) / 10 : 0, lastTargetedAt };
      res.json({ ok: true, count: audits.length, summary, rows: audits.slice(0, 500) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GET /api/dashboard -> simple auto-refresh HTML
  router.get('/dashboard', async (_req: any, res: any) => {
    const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Enrichment Dashboard</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:20px;color:#222}
  h1{font-size:20px;margin:0 0 12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .card{border:1px solid #ddd;border-radius:8px;padding:12px}
  .kpi{font-size:14px}
  .progress{background:#eee;height:10px;border-radius:6px;overflow:hidden;margin-top:6px}
  .bar{background:#2d8; height:100%; width:0%}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
  th,td{border:1px solid #eee;padding:6px;text-align:left}
  th{background:#fafafa}
  .muted{color:#666;font-size:12px}
  input{padding:6px}
  button{padding:6px 10px;margin-left:6px}
  .ok{color:#080}
  .warn{color:#b80}
  .bad{color:#a00}
  .skip{color:#06c}
  .row{display:flex;align-items:center;gap:8px}
  footer{margin-top:16px;color:#666;font-size:12px}
  .tabs{display:flex;gap:6px;margin-bottom:10px}
  .tab{padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:#fafafa;cursor:pointer}
  .tab.active{background:#eef;border-color:#aac}
  .hidden{display:none}
</style></head>
<body>
<h1>Enrichment Dashboard</h1>
<div class="tabs">
  <button id="tab-inmate" class="tab active" onclick="switchView('inmate')">Inmate view</button>
  <button id="tab-enrich" class="tab" onclick="switchView('enrich')">Enrichment tracking</button>
  <button id="tab-prospects" class="tab" onclick="switchView('prospects')">Prospects</button>
  <button id="tab-notbond" class="tab" onclick="switchView('notbond')">Not bondable</button>
</div>
<div class="grid">
  <div class="card" id="cov" data-view="inmate">
    <div class="row"><strong>72h Coverage</strong><span class="muted" id="cov-ts"></span></div>
    <div class="kpi" id="cov-kpi"></div>
    <div class="progress"><div class="bar" id="cov-bar"></div></div>
    <div class="muted" id="cov-detail"></div>
    <div class="muted">Legend: <span class="ok">DOB found</span> = success, <span class="skip">Not in jail</span> = skipped, <span class="bad">Unresolved</span> = failed</div>
    <div class="muted" id="cov-flags"></div>
  </div>
  <div class="card" id="cov24" data-view="inmate">
    <div class="row"><strong>24h Coverage (bond ≥ $1,000)</strong><span class="muted" id="cov24-ts"></span></div>
    <div class="kpi" id="cov24-kpi"></div>
    <div class="progress"><div class="bar" id="cov24-bar"></div></div>
    <div class="muted" id="cov24-detail"></div>
    <div class="muted" id="cov24-flags"></div>
    <pre class="muted" id="cov24-json" style="white-space:pre-wrap"></pre>
  </div>
  <div class="card" id="cov24_500" data-view="inmate">
    <div class="row"><strong>24h Coverage (bond ≥ $500)</strong><span class="muted" id="cov24_500-ts"></span></div>
    <div class="kpi" id="cov24_500-kpi"></div>
    <div class="progress"><div class="bar" id="cov24_500-bar"></div></div>
    <div class="muted" id="cov24_500-detail"></div>
    <div class="muted" id="cov24_500-flags"></div>
    <pre class="muted" id="cov24_500-json" style="white-space:pre-wrap"></pre>
  </div>
  <div class="card" id="batch" data-view="enrich">
    <div class="row"><strong>Batch Progress</strong><span class="muted">(suffix optional)</span></div>
    <div class="row"><input id="suffix" placeholder="job suffix e.g. 1760644231"/>
      <select id="batch-filter">
        <option value="ALL">All</option>
        <option value="SUCCEEDED">DOB found</option>
        <option value="SKIPPED">Not in jail</option>
        <option value="UNRESOLVED">Unresolved</option>
      </select>
      <label><input type="checkbox" id="flag-notBondable"/> Not bondable</label>
      <label><input type="checkbox" id="flag-moreCharges"/> More charges</label>
      <label class="muted">windowHours <input id="batch-window" type="number" min="1" max="168" value="24" style="width:64px"/></label>
      <button onclick="loadBatch()">Load</button></div>
    <div class="kpi" id="batch-kpi"></div>
    <div class="muted" id="unresolved-kpi"></div>
    <table><thead><tr><th>Job</th><th>Subject</th><th>Status</th><th>HCSO DOB</th></tr></thead><tbody id="batch-rows"></tbody></table>
  </div>
  <div class="card" id="providers" data-view="enrich">
    <div class="row"><strong>Provider Stats (24h)</strong><span class="muted" id="prov-ts"></span></div>
    <div class="kpi" id="prov-kpi"></div>
    <pre class="muted" id="prov-json" style="white-space:pre-wrap"></pre>
    <div class="muted" id="prov-hint" style="margin-top:6px"></div>
  </div>
  <div class="card" id="prov_unres" data-view="enrich">
    <div class="row"><strong>Provider Unresolved Breakdown (24h)</strong><span class="muted" id="provun-ts"></span></div>
    <div class="kpi" id="provun-kpi"></div>
    <pre class="muted" id="provun-json" style="white-space:pre-wrap"></pre>
  </div>
  <div class="card" id="queue" data-view="enrich">
    <div class="row"><strong>Queue Stats</strong><span class="muted" id="queue-ts"></span></div>
    <div class="kpi" id="queue-kpi"></div>
    <pre class="muted" id="queue-json" style="white-space:pre-wrap"></pre>
  </div>
  <div class="card" id="prospects" data-view="prospects">
    <div class="row"><strong>Prospects</strong><span class="muted" id="prospects-ts"></span></div>
    <div class="row">
      <label class="muted">minBond $<input id="prospects-minBond" type="number" min="0" step="100" value="500" style="width:80px"/></label>
      <label class="muted">window
        <select id="prospects-window"><option value="24">24h</option><option value="48" selected>48h</option><option value="72">72h</option></select>
      </label>
      <label class="muted"><input id="prospects-includeNotBondable" type="checkbox"/> include notBondable</label>
      <label class="muted">limit <input id="prospects-limit" type="number" min="1" max="200" value="50" style="width:64px"/></label>
      <button onclick="loadProspects()">Load</button>
    </div>
    <div class="kpi" id="prospects-kpi"></div>
    <div class="muted" id="prospects-flags"></div>
  <table><thead><tr><th>Subject</th><th>Bond</th><th>DOB</th><th>Booking</th><th>Base address</th><th>Flags</th></tr></thead><tbody id="prospects-rows"></tbody></table>
  </div>
  <div class="card" id="notbondable" data-view="notbond">
    <div class="row"><strong>Not Bondable</strong><span class="muted" id="nb-ts"></span></div>
    <div class="row">
      <label class="muted">minBond $<input id="nb-minBond" type="number" min="0" step="100" value="0" style="width:80px"/></label>
      <label class="muted">window
        <select id="nb-window"><option value="24">24h</option><option value="48" selected>48h</option><option value="72">72h</option></select>
      </label>
      <label class="muted"><input id="nb-strict" type="checkbox" checked/> strict only</label>
      <label class="muted">limit <input id="nb-limit" type="number" min="0" max="200" value="50" style="width:64px"/></label>
      <button onclick="loadNotBondable()">Load</button>
    </div>
    <div class="kpi" id="nb-kpi"></div>
  <table><thead><tr><th>Subject</th><th>Bond</th><th>DOB</th><th>Booking</th><th>Base address</th><th>Reason</th><th>Flags</th></tr></thead><tbody id="nb-rows"></tbody></table>
  </div>
</div>
<footer>Auto-refreshing every 10s</footer>
<script>
async function loadCoverage(){
  try{
    const r=await fetch('enrichment/coverage72h'); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    const k='Total: '+j.total+' — Done: '+(j.haveDob+j.notInJail)+' (DOB: '+j.haveDob+', Not in jail: '+j.notInJail+') — Unresolved: '+j.unresolved;
    document.getElementById('cov-kpi').textContent=k;
    document.getElementById('cov-bar').style.width=(j.pct||0)+'%';
    document.getElementById('cov-detail').textContent = 'Completion: '+(j.pct||0)+'%';
    document.getElementById('cov-ts').textContent = new Date().toLocaleTimeString();
    document.getElementById('cov-flags').textContent = 'Flags — Not bondable: '+(j.notBondable||0)+', More charges: '+(j.moreCharges||0);
  }catch(e){
    document.getElementById('cov-kpi').textContent='Error loading coverage: '+e;
  }
}
async function loadCoverage24(){
  try{
    const r=await fetch('enrichment/coverage24h?minBond=1000'); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
  const k='Total: '+j.total+' — Done: '+(j.haveDob+j.notInJail)+' (DOB: '+j.haveDob+', Not in jail: '+j.notInJail+') — Unresolved: '+j.unresolved;
    document.getElementById('cov24-kpi').textContent=k;
    document.getElementById('cov24-bar').style.width=(j.pct||0)+'%';
    document.getElementById('cov24-detail').textContent = 'Completion: '+(j.pct||0)+'%';
    document.getElementById('cov24-ts').textContent = new Date().toLocaleTimeString();
    document.getElementById('cov24-flags').textContent = 'Flags — Not bondable: '+(j.notBondable||0)+', More charges: '+(j.moreCharges||0);
  document.getElementById('cov24-json').textContent = JSON.stringify(j, null, 2);
  }catch(e){
    document.getElementById('cov24-kpi').textContent='Error loading 24h coverage: '+e;
  }
}
async function loadCoverage24_500(){
  try{
    const r=await fetch('enrichment/coverage24h?minBond=500'); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    const k='Total: '+j.total+' — Done: '+(j.haveDob+j.notInJail)+' (DOB: '+j.haveDob+', Not in jail: '+j.notInJail+') — Unresolved: '+j.unresolved;
    document.getElementById('cov24_500-kpi').textContent=k;
    document.getElementById('cov24_500-bar').style.width=(j.pct||0)+'%';
    document.getElementById('cov24_500-detail').textContent = 'Completion: '+(j.pct||0)+'%';
    document.getElementById('cov24_500-ts').textContent = new Date().toLocaleTimeString();
    document.getElementById('cov24_500-flags').textContent = 'Flags — Not bondable: '+(j.notBondable||0)+', More charges: '+(j.moreCharges||0);
    document.getElementById('cov24_500-json').textContent = JSON.stringify(j, null, 2);
  }catch(e){
    document.getElementById('cov24_500-kpi').textContent='Error loading 24h coverage (500): '+e;
  }
}
async function loadBatch(){
  const s=(document.getElementById('suffix').value||'').trim();
  const filter=(document.getElementById('batch-filter').value||'ALL');
  let qs=[]; if(s) qs.push('suffix='+encodeURIComponent(s)); if(filter && filter!=='ALL') qs.push('stepStatus='+encodeURIComponent(filter));
  if(document.getElementById('flag-notBondable').checked) qs.push('notBondable=true');
  if(document.getElementById('flag-moreCharges').checked) qs.push('moreCharges=true');
  const wh = Number(document.getElementById('batch-window').value||24);
  if(wh) qs.push('windowHours='+encodeURIComponent(String(wh)));
  const url='enrichment/batch'+(qs.length?'?'+qs.join('&'):'');
  let j={total:0,countsByStatus:{},countsByStep:{},rows:[]};
  try{
    const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
    j=await r.json();
  }catch(e){
    document.getElementById('batch-kpi').textContent='Error loading batch: '+e;
  }
  try{
    const bUrl='enrichment/unresolved_breakdown'+(s?'?suffix='+encodeURIComponent(s):'');
    const rb=await fetch(bUrl); if(rb.ok){ const bj=await rb.json();
      const rr=bj.reasons||{}; document.getElementById('unresolved-kpi').textContent='Unresolved breakdown — NO_RECORD: '+(rr.NO_RECORD||0)+', DOB_NOT_FOUND: '+(rr.DOB_NOT_FOUND||0)+', error: '+(rr.error||0)+', other: '+(rr.other||0);
    }
  }catch(e){ /* ignore */ }
  var sc=(j.countsByStep||{});
  var scSucc=sc.hcso_dob_succeeded||0, scSkip=sc.hcso_dob_skipped||0, scFail=sc.hcso_dob_unresolved||0;
  document.getElementById('batch-kpi').innerHTML = 'Jobs: '+j.total+' — Status: '
    +Object.entries(j.countsByStatus||{}).map(function(p){return p[0]+': '+p[1]}).join(', ')
    +' — Steps: '
    +'<span class="ok">DOB found: '+scSucc+'</span>, '
    +'<span class="skip">Not in jail: '+scSkip+'</span>, '
    +'<span class="bad">Unresolved: '+scFail+'</span>';
  const tb=document.getElementById('batch-rows'); tb.innerHTML='';
  var rows=(j.rows||[]);
  for(const row of rows){
    const tr=document.createElement('tr');
    var label=row.hcso_dob||'N/A'; var cls='';
    if(label==='SUCCEEDED'){ label='DOB found'; cls='ok'; }
    else if(label==='SKIPPED'){ label='Not in jail'; cls='skip'; }
    else if(label==='FAILED' || label==='UNRESOLVED'){ label='Unresolved'; cls='bad'; }
    var reason=row.reason?(' — '+row.reason):'';
    tr.innerHTML='<td>'+row.jobId+'</td><td>'+row.subjectId+'</td><td>'+row.status+'</td><td class="'+cls+'">'+label+reason+'</td>';
    tb.appendChild(tr);
  }
}
let currentView = 'inmate';
function switchView(v){
  currentView = v;
  try{ localStorage.setItem('dashView', v); }catch{}
  const cards = document.querySelectorAll('.card');
  for (const c of cards){
    const want = c.getAttribute('data-view') || 'inmate';
    if (want === v) c.classList.remove('hidden'); else c.classList.add('hidden');
  }
  document.getElementById('tab-inmate').classList.toggle('active', v==='inmate');
  document.getElementById('tab-enrich').classList.toggle('active', v==='enrich');
  document.getElementById('tab-prospects').classList.toggle('active', v==='prospects');
  document.getElementById('tab-notbond').classList.toggle('active', v==='notbond');
}
async function loadProviders(){
  try{
    const r=await fetch('enrichment/provider_stats?windowHours=24'); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    const s=j.steps||{};
    const pdl=j.pdl||{}; const pipl=j.pipl||{};
    const piplCost=(j.cost&&j.cost.pipl)||{}; const piplHour=(piplCost.hourUsage||{}), piplDay=(piplCost.dayUsage||{});
    const pdlCost=(j.cost&&j.cost.pdl)||{}; const pdlHour=(pdlCost.hourUsage||{}), pdlDay=(pdlCost.dayUsage||{});
    const k='Pipl — SUC:'+ (s.pipl_search_succeeded||0)+', SKP:'+(s.pipl_search_skipped||0)+', UNR:'+(s.pipl_search_unresolved||0)
      +' | Network: '+(pipl.networkCalls||0)
      +' | Budget hr: '+(piplHour.used||0)+'/'+(piplHour.max||0)+' ('+(piplHour.pct||0)+'%) day: '+(piplDay.used||0)+'/'+(piplDay.max||0)+' ('+(piplDay.pct||0)+'%)'
      +' || PDL — SUC:'+ (s.pdl_search_succeeded||0)+', SKP:'+(s.pdl_search_skipped||0)+', UNR:'+(s.pdl_search_unresolved||0)
      +' | Cache: '+(pdl.cacheHits||0)+' / Network: '+(pdl.networkCalls||0)
      +' | Budget hr: '+(pdlHour.used||0)+'/'+(pdlHour.max||0)+' ('+(pdlHour.pct||0)+'%) day: '+(pdlDay.used||0)+'/'+(pdlDay.max||0)+' ('+(pdlDay.pct||0)+'%)'
      +' || WP — SUC:'+ (s.whitepages_succeeded||0)+', SKP:'+(s.whitepages_skipped||0)+', UNR:'+(s.whitepages_unresolved||0);
    document.getElementById('prov-kpi').textContent=k;
    document.getElementById('prov-json').textContent=JSON.stringify(j,null,2);
    document.getElementById('prov-ts').textContent=new Date().toLocaleTimeString();
    // Also load provider list to show a helpful hint when only one or none are enabled
    try{
      const pr = await fetch('enrichment/providers');
      if (pr.ok){
        const pj = await pr.json();
        const list = Array.isArray(pj.providers) ? pj.providers.filter((p)=>p.enabled) : [];
        const hintEl = document.getElementById('prov-hint');
        if (list.length <= 1){
          hintEl.textContent = 'Hint: Only '+(list.length||0)+' provider enabled. To enable more, set PROVIDER_*_ENABLED=true and API keys in enrichment .env, then restart the API.';
        } else {
          hintEl.textContent = '';
        }
      }
    }catch(e){ /* ignore hint errors */ }
  }catch(e){ document.getElementById('prov-kpi').textContent='Error loading provider stats: '+e; }
}
async function loadQueue(){
  try{
    const r=await fetch('enrichment/queue_stats?windowMinutes=60'); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    const c=j.counts||{};
    const k='waiting:'+ (c.waiting||0)+', active:'+(c.active||0)+', delayed:'+(c.delayed||0)+', completed:'+(c.completed||0)+', failed:'+(c.failed||0)+' | throughput (jobs/min): '+(j.approxThroughputPerMin||0);
    document.getElementById('queue-kpi').textContent=k;
    document.getElementById('queue-json').textContent=JSON.stringify(j,null,2);
    document.getElementById('queue-ts').textContent=new Date().toLocaleTimeString();
  }catch(e){ document.getElementById('queue-kpi').textContent='Error loading queue stats: '+e; }
}
async function loadProviderUnresolved(){
  try{
    const r=await fetch('enrichment/provider_unresolved_breakdown?windowHours=24'); if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    const b=j.breakdown||{}; const pdl=b.pdl_search||{}; const pipl=b.pipl_search||{}; const wp=b.whitepages||{};
    const k='Pipl: '+Object.entries(pipl).map(function(p){return p[0]+': '+p[1]}).join(', ')
      +' | PDL: '+Object.entries(pdl).map(function(p){return p[0]+': '+p[1]}).join(', ')
      +' | WP: '+Object.entries(wp).map(function(p){return p[0]+': '+p[1]}).join(', ');
    document.getElementById('provun-kpi').textContent=k||'—';
    document.getElementById('provun-json').textContent=JSON.stringify(j,null,2);
    document.getElementById('provun-ts').textContent=new Date().toLocaleTimeString();
  }catch(e){ document.getElementById('provun-kpi').textContent='Error loading provider unresolved: '+e; }
}
async function loadProspects(){
  const minBond = Number(document.getElementById('prospects-minBond').value||500);
  const limit = Number(document.getElementById('prospects-limit').value||50);
  const wh = Number(document.getElementById('prospects-window').value||48);
  const incl = document.getElementById('prospects-includeNotBondable').checked;
  const url = 'enrichment/prospects_window?windowHours='+encodeURIComponent(String(wh))+'&minBond='+encodeURIComponent(String(minBond))+'&limit='+encodeURIComponent(String(limit))+(incl?'&includeNotBondable=true':'');
  try{
    const r = await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
    const j = await r.json();
    const k = 'Total eligible: '+(j.total||0)+' — Showing: '+(j.count||0)+' — minBond: $'+(j.minBond||minBond)+ (incl?' (including notBondable)':'');
    document.getElementById('prospects-kpi').textContent = k;
    document.getElementById('prospects-flags').textContent = 'Excluded (strict notBondable): '+(j.excludedStrictNotBondable||0)+' — moreChargesPossible flags: '+(j.moreChargesPossibleCount||0);
    document.getElementById('prospects-ts').textContent = new Date().toLocaleTimeString();
    const tb = document.getElementById('prospects-rows'); tb.innerHTML='';
    for (const row of (j.rows||[])){
      const tr = document.createElement('tr');
      const bondVal = (row.bond!=null)? ('$'+row.bond.toLocaleString()): '—';
      const flags = [];
      if (row.notBondableStrict) flags.push('notBondableStrict'); else if (row.notBondable) flags.push('notBondable');
      if (row.moreChargesPossible) flags.push('moreChargesPossible');
      if (row.bondExceptionText) flags.push(row.bondExceptionText);
  tr.innerHTML = '<td>'+row.subjectId+'</td>'+
         '<td>'+bondVal+'</td>'+
         '<td>'+(row.dob||'—')+'</td>'+
         '<td>'+(row.bookingDate? new Date(row.bookingDate).toLocaleString() : '—')+'</td>'+
         '<td>'+(row.baseAddressSnippet||'—')+'</td>'+
         '<td>'+(flags.join(', ')||'—')+'</td>';
      tb.appendChild(tr);
    }
  }catch(e){
    document.getElementById('prospects-kpi').textContent = 'Error loading prospects: '+e;
  }
}
async function loadNotBondable(){
  const minBond = Number(document.getElementById('nb-minBond').value||0);
  const wh = Number(document.getElementById('nb-window').value||48);
  const strict = document.getElementById('nb-strict').checked;
  const limit = Number(document.getElementById('nb-limit').value||50);
  const url = 'enrichment/not_bondable?windowHours='+encodeURIComponent(String(wh))+'&minBond='+encodeURIComponent(String(minBond))+'&limit='+encodeURIComponent(String(limit))+(strict?'&strict=true':'&strict=false');
  try{
    const r = await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
    const j = await r.json();
    document.getElementById('nb-kpi').textContent = 'Total: '+(j.total||0)+' — Showing: '+(j.count||0)+' — '+(strict?'strict only':'any notBondable');
    document.getElementById('nb-ts').textContent = new Date().toLocaleTimeString();
    const tb = document.getElementById('nb-rows'); tb.innerHTML='';
    for (const row of (j.rows||[])){
      const tr = document.createElement('tr');
      const flags = [];
      if (row.moreChargesPossible) flags.push('moreChargesPossible');
  tr.innerHTML = '<td>'+row.subjectId+'</td>'+
                     '<td>'+(row.bond!=null?('$'+row.bond.toLocaleString()):'—')+'</td>'+
                     '<td>'+(row.dob||'—')+'</td>'+
                     '<td>'+(row.bookingDate? new Date(row.bookingDate).toLocaleString() : '—')+'</td>'+
         '<td>'+(row.baseAddressSnippet||'—')+'</td>'+
                     '<td>'+(row.reason||'—')+'</td>'+
                     '<td>'+(flags.join(', ')||'—')+'</td>';
      tb.appendChild(tr);
    }
  }catch(e){
    document.getElementById('nb-kpi').textContent = 'Error loading not-bondable: '+e;
  }
}
async function tick(){
  if (currentView==='inmate'){
    await loadCoverage(); await loadCoverage24(); await loadCoverage24_500();
  } else {
    if (currentView==='enrich'){
      await loadBatch(); await loadProviders(); await loadProviderUnresolved(); await loadQueue();
    } else if (currentView==='prospects'){
      await loadProspects();
    } else if (currentView==='notbond'){
      await loadNotBondable();
    }
  }
}
// initialize view from storage/query
(function(){
  let v = 'inmate';
  try{ v = localStorage.getItem('dashView') || v; }catch{}
  const qp = new URLSearchParams(window.location.search);
  if (qp.get('view') === 'enrich') v = 'enrich';
  if (qp.get('view') === 'prospects') v = 'prospects';
  if (qp.get('view') === 'notbond') v = 'notbond';
  switchView(v);
})();
tick(); setInterval(tick, 10000);
</script>
</body></html>`;
    res.type('html').send(html);
  });

  return router;
}
