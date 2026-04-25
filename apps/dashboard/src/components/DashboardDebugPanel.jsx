// src/components/DashboardDebugPanel.jsx
// Lightweight debug panel showing polling state, variant headers, and server metrics.
// Renders nothing in production builds unless explicitly mounted behind a flag.
import React, { useEffect, useState, useCallback } from 'react';
import { API_BASE } from '../hooks/dashboard.js';
import { getAuthHeader } from '../lib/api';
import { useOptionalDashboardAggregated } from './DashboardAggregatedProvider.jsx';

async function fetchMetrics(signal) {
  const auth = await getAuthHeader();
  return fetch(`${API_BASE}/dashboard/metrics?_cb=${Date.now()}`, {
    signal,
    headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache', ...(auth||{}) },
    cache: 'no-store',
    credentials: 'include',
  })
    .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(t || r.statusText); }))
    .catch(err => ({ error: err.message || String(err) }));
}

function prettyMillis(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms/1000).toFixed(2)}s`;
}

export default function DashboardDebugPanel({ refreshInterval = 60000 }) {
  const agg = useOptionalDashboardAggregated();
  const [metrics, setMetrics] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    const ctl = new AbortController();
    setLoading(true); setError(null);
    fetchMetrics(ctl.signal).then(json => {
      if (json?.error) setError(json.error); else setMetrics(json);
      setLastFetch(Date.now());
    }).catch(e => setError(e.message || String(e))).finally(() => setLoading(false));
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    load();
    if (!refreshInterval) return;
    const id = setInterval(load, refreshInterval);
    return () => clearInterval(id);
  }, [load, refreshInterval]);

  const variants = Object.entries(agg?.data || {})
    .filter(([k]) => k.endsWith('__variant'))
    .map(([k,v]) => ({ key: k.replace(/__variant$/, ''), variant: v }));

  const rows = (metrics?.routes ? Object.entries(metrics.routes) : []).map(([route, m]) => {
    return { route, count: m.count, errors: m.errors, p50: m.p50, p90: m.p90, p95: m.p95, p99: m.p99, variants: m.variants };
  }).sort((a,b) => a.route.localeCompare(b.route));

  const adaptiveMeta = agg?.getMetaSnapshot ? agg.getMetaSnapshot() : agg?.meta || {};
  const adaptiveKeys = Object.keys(adaptiveMeta).sort();
  const resetAll = () => agg?.resetAdaptive && agg.resetAdaptive();

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md w-[420px] bg-white border border-slate-300 shadow-xl rounded-xl text-[11px] font-mono p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-700">Dashboard Debug</div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">Reload</button>
        </div>
      </div>
      <div className="text-slate-500 flex flex-wrap gap-x-2 gap-y-1">
        <span>pollRunning:{String(agg?.running)}</span>
        <span>dataKeys:{Object.keys(agg?.data||{}).length}</span>
        <span>lastMetrics:{lastFetch ? prettyMillis(Date.now()-lastFetch)+ ' ago' : '—'}</span>
        {loading ? <span className="text-amber-600">loading…</span> : null}
        {error ? <span className="text-red-600">err:{error}</span> : null}
      </div>

      {variants.length ? (
        <div>
          <div className="font-semibold text-slate-600 mb-1">Variants</div>
          <ul className="space-y-0.5 max-h-24 overflow-auto pr-1">
            {variants.map(v => (
              <li key={v.key} className="flex justify-between gap-2"><span className="truncate">{v.key}</span><span className="text-blue-600">{v.variant}</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <div className="font-semibold text-slate-600 mb-1">Route Metrics</div>
        <div className="max-h-40 overflow-auto pr-1 border border-slate-200 rounded">
          <table className="min-w-full text-[10px]">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-1 py-0.5">Route</th>
                <th className="text-right px-1 py-0.5">Cnt</th>
                <th className="text-right px-1 py-0.5">Err</th>
                <th className="text-right px-1 py-0.5">p95</th>
                <th className="text-right px-1 py-0.5">Variants</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.route} className="odd:bg-white even:bg-slate-50">
                  <td className="px-1 py-0.5 truncate max-w-[120px]" title={r.route}>{r.route}</td>
                  <td className="px-1 py-0.5 text-right tabular-nums">{r.count}</td>
                  <td className="px-1 py-0.5 text-right tabular-nums text-red-600">{r.errors||0}</td>
                  <td className="px-1 py-0.5 text-right tabular-nums">{prettyMillis(r.p95)}</td>
                  <td className="px-1 py-0.5 text-right tabular-nums">
                    {r.variants && typeof r.variants === 'object'
                      ? Object.entries(r.variants).map(([v, c]) => {
                          const value = typeof c === 'object' && c !== null
                            ? Object.entries(c)
                                .map(([key, val]) => `${key}:${val}`)
                                .join(',')
                            : c;
                          return (
                            <span
                              key={v}
                              className="inline-block px-1 bg-slate-200 rounded mr-0.5"
                              title={v}
                            >
                              {v}:{value}
                            </span>
                          );
                        })
                      : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-slate-600">Adaptive State</div>
          <button onClick={resetAll} className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">Reset</button>
        </div>
        <div className="max-h-40 overflow-auto border border-slate-200 rounded">
          <table className="min-w-full text-[10px]">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-1 py-0.5">Key</th>
                <th className="text-right px-1 py-0.5">Mult</th>
                <th className="text-right px-1 py-0.5">Stable</th>
                <th className="text-right px-1 py-0.5">Backoff</th>
                <th className="text-right px-1 py-0.5">ETA</th>
              </tr>
            </thead>
            <tbody>
              {adaptiveKeys.map(k => {
                const m = adaptiveMeta[k];
                return (
                  <tr key={k} className="odd:bg-white even:bg-slate-50">
                    <td className="px-1 py-0.5 truncate max-w-[90px]" title={k}>{k}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{m.intervalMultiplier}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{m.stable}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{m.backoff ? prettyMillis(m.backoff) : '—'}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums" title={`nextAt=${new Date(m.nextAt).toLocaleTimeString()}`}>{prettyMillis(m.etaMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
