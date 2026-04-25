// src/hooks/polling.js
// Reusable serialized polling hook to avoid overlapping network requests and
// StrictMode double-mount duplication. Intended for aggregating a handful of
// dashboard endpoints with different intervals while ensuring only one request
// is in-flight at a time.
//
// Features:
//  - Single loop (per hook instance) that walks endpoints sequentially.
//  - Per-endpoint interval tracking (won't refetch earlier than its interval).
//  - Backoff on errors with capped exponential delay (per endpoint).
//  - Pauses automatically when document.visibilityState !== 'visible'.
//  - Provides manual refresh() to immediately schedule next eligible pass.
//  - Guards against React StrictMode double effect execution.
//  - Optional integration with React Query (pushes results into query cache).
//
// Usage Example:
// const { data, errors, refresh, running } = useSerializedPolling([
//   { key: 'kpis', path: '/dashboard/kpis', interval: 30000 },
//   { key: 'top24', path: '/dashboard/top?window=24h&limit=10', interval: 60000 },
//   { key: 'perCounty24', path: '/dashboard/per-county?window=24h', interval: 120000 },
// ]);
//
// You can then consume data.kpis, data.top24, etc. without each component
// spawning its own poller. Helps reduce duplicate / aborted requests.

import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE } from './dashboard.js';
import { getAuthHeader } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';

async function fetchJSONWithHeaders(fullUrl) {
  const auth = await getAuthHeader();
  const res = await fetch(fullUrl, {
    headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache', ...(auth||{}) },
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0,200)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return { json, headers: res.headers };
}

function buildUrl(path) {
  const base = `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
  // Use a stable cache-buster bucket (5s window) to allow very short-term dedupe but still defeat stale CDN/proxy caches if any
  const bucket = Math.floor(Date.now() / 5000) * 5000;
  const u = base.includes('?') ? `${base}&_cb=${bucket}` : `${base}?_cb=${bucket}`;
  return u;
}

export function useSerializedPolling(endpoints, { enabled = true, align = true, adaptive = true } = {}) {
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  const [running, setRunning] = useState(false);
  const startedRef = useRef(false); // StrictMode guard
  const stopRef = useRef(false);
  const scheduleRef = useRef(null);
  const metaRef = useRef({}); // key -> { last:0, backoff:0, stable:0, hash:null, intervalMultiplier:1 }
  const queryClient = useQueryClient();

  const refresh = useCallback(() => {
    // Force immediate eligibility by resetting last timestamps
    Object.values(metaRef.current).forEach(m => { m.last = 0; });
    if (scheduleRef.current) clearTimeout(scheduleRef.current);
    scheduleRef.current = setTimeout(() => runLoop(), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { stopRef.current = true; if (scheduleRef.current) clearTimeout(scheduleRef.current); }, []);

  const runLoop = useCallback(async () => {
    if (stopRef.current || !enabled) return;
    setRunning(true);
    const now = Date.now();
    const visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible';

    for (const ep of endpoints) {
      const { key, path, interval = 60000, adaptiveSample } = ep;
      if (!metaRef.current[key]) metaRef.current[key] = { last: 0, backoff: 0, stable: 0, hash: null, intervalMultiplier: 1 };
      const meta = metaRef.current[key];

      // Effective interval may be scaled if adaptive enabled and payload stable
      const effInterval = adaptive && meta.intervalMultiplier > 1 ? interval * meta.intervalMultiplier : interval;
      const due = now - meta.last >= effInterval;
      if (!due || !visible) continue; // skip if not due or tab hidden

      try {
        const url = buildUrl(path);
        const { json, headers } = await fetchJSONWithHeaders(url);

        // Build a small hash for adaptive comparison. Allow endpoint to provide custom sampler.
        let hashSource;
        try {
          if (typeof adaptiveSample === 'function') {
            hashSource = adaptiveSample(json);
          } else if (json && typeof json === 'object') {
            // Heuristic: prefer stable summary fields to avoid large stringify cost
            if (Array.isArray(json.items)) {
              // Sample first few items' ids + length + maybe aggregate fields
              const first = json.items.slice(0, 5).map(it => it.id || it.case_id || it._id || it.booking_number || it.name || '').join('|');
              hashSource = { len: json.items.length, first, extra: json.count || json.total || json.sum || null };
            } else if (Array.isArray(json)) {
              const first = json.slice(0, 5).map(it => (it && (it.id || it._id || it.case_id || it.booking_number || it.name)) || '').join('|');
              hashSource = { len: json.length, first };
            } else {
              // Pick numeric fields + counts
              const picked = {};
              Object.keys(json).forEach(k => {
                const v = json[k];
                if (v == null) return;
                if (typeof v === 'number' || typeof v === 'string') picked[k] = v;
                if (Array.isArray(v)) picked[k] = v.length; // treat arrays by length only
              });
              hashSource = picked;
            }
          } else {
            hashSource = json;
          }
        } catch {
          hashSource = json;
        }
        const hash = (() => {
          try { return JSON.stringify(hashSource); } catch { return String(hashSource); }
        })();

        // Compare to previous hash to adjust stability counters
        if (adaptive) {
          if (meta.hash && meta.hash === hash) {
            meta.stable += 1;
          } else {
            meta.stable = 0;
            meta.intervalMultiplier = 1; // reset multiplier on change
          }
          meta.hash = hash;

          // Escalate interval multiplier based on stability plateaus
          // Tiers: after 3 unchanged -> x2, after 6 -> x4, after 12 -> x8 (cap), reset on change/visibility toggle
          if (meta.stable === 3) meta.intervalMultiplier = 2;
          else if (meta.stable === 6) meta.intervalMultiplier = 4;
          else if (meta.stable === 12) meta.intervalMultiplier = 8;
        }

        setData(prev => ({ ...prev, [key]: json }));
        setErrors(prev => { const { [key]: _, ...rest } = prev; return rest; });
        meta.last = Date.now();
        meta.backoff = 0;
        // DEBUG
        if (typeof console !== 'undefined') {
          console.log(`[polling] ${key}: success, data=`, json);
        }
        // Push into React Query cache (optional consumption) if there's a watcher
        try { queryClient.setQueryData([key], json); } catch { /* noop */ }
        // Optionally record variant header for debugging
        const variantHeader = Array.from(headers.keys()).find(k => /variant/i.test(k));
        if (variantHeader) {
          setData(prev => ({ ...prev, [`${key}__variant`]: headers.get(variantHeader) }));
        }
      } catch (err) {
        meta.last = Date.now();
        meta.backoff = Math.min(meta.backoff ? meta.backoff * 2 : 2000, 60000); // up to 60s
        setErrors(prev => ({ ...prev, [key]: err }));
        // DEBUG
        if (typeof console !== 'undefined') {
          console.log(`[polling] ${key}: error`, err);
        }
      }
      // Respect backoff delay before moving on if error occurred (yielding event loop)
      if (meta.backoff) await new Promise(res => setTimeout(res, 50));
    }

    // Compute next wake time = min(nextDue, now + 5s) for coarse alignment
    const nextTimes = endpoints.map(ep => {
      const meta = metaRef.current[ep.key];
      const interval = ep.interval || 60000;
      const mult = adaptive && meta.intervalMultiplier ? meta.intervalMultiplier : 1;
      const baseNext = (meta.last || 0) + interval * mult + (meta.backoff || 0);
      return baseNext;
    });
    const soonest = Math.min(...nextTimes);
    const delay = Math.max(align ? soonest - Date.now() : 1000, 500); // at least 0.5s
    scheduleRef.current = setTimeout(runLoop, delay);
  }, [endpoints, enabled, align, adaptive, queryClient]);

  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current) return; // StrictMode second mount skip
    startedRef.current = true;
    runLoop();
  }, [enabled, runLoop]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible') refresh();
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility); };
  }, [refresh]);

  const getMetaSnapshot = useCallback(() => {
    const out = {};
    Object.entries(metaRef.current).forEach(([k, v]) => {
      const interval = (endpoints.find(ep => ep.key === k)?.interval) || 60000;
      const mult = v.intervalMultiplier || 1;
      const nextAt = (v.last || 0) + interval * mult + (v.backoff || 0);
      out[k] = {
        last: v.last,
        backoff: v.backoff,
        stable: v.stable,
        intervalMultiplier: mult,
        effectiveInterval: interval * mult,
        nextAt,
        etaMs: Math.max(0, nextAt - Date.now()),
      };
    });
    return out;
  }, [endpoints]);

  const resetAdaptive = useCallback((keys) => {
    const target = keys && keys.length ? keys : Object.keys(metaRef.current);
    target.forEach(k => {
      if (!metaRef.current[k]) return;
      metaRef.current[k].stable = 0;
      metaRef.current[k].intervalMultiplier = 1;
      metaRef.current[k].hash = null;
      metaRef.current[k].last = 0; // make eligible immediately
    });
    refresh();
  }, [refresh]);

  return { data, errors, refresh, running, meta: getMetaSnapshot(), getMetaSnapshot, resetAdaptive };
}

export default useSerializedPolling;
