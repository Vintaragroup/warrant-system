import { useState, useEffect, useRef, Component } from 'react';
import { SectionCard, DataTable } from '../components/PageToolkit';
import {
  useIngestionStatus,
  useIngestionRuns,
  useIngestionErrors,
  useIngestionConfig,
  useUpdateIngestionConfig,
  useTriggerRun,
  usePauseSource,
  useResumeSource,
  useIngestionReadiness,
  useCancelJob,
} from '../hooks/adminIngestion';
import { getJSON, sendJSON } from '../hooks/dashboard';

// ── Error boundary ─────────────────────────────────────────────────────────────

class ScraperOpsBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { caught: null };
  }

  static getDerivedStateFromError(error) {
    return { caught: error };
  }

  render() {
    if (this.state.caught) {
      return (
        <SectionCard title="Scraper Operations" subtitle="Monitor and control the v2 ingestion pipeline">
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
            <p className="font-semibold">Panel failed to render.</p>
            <p className="mt-1 text-xs opacity-80">{this.state.caught.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ caught: null })}
              className="mt-3 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
            >
              Retry
            </button>
          </div>
        </SectionCard>
      );
    }
    return this.props.children;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCES = [
  'galveston',
  'harris_reports',
  'wharton',
  'fortbend_lookup',
  'jefferson_lookup',
  'brazoria_lookup',
];

const LOOKUP_SOURCES = new Set(['fortbend_lookup', 'jefferson_lookup', 'brazoria_lookup']);

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'run', label: 'Run Now' },
  { id: 'discovery', label: 'Lookup Discovery' },
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'runs', label: 'Run History' },
  { id: 'errors', label: 'Errors' },
  { id: 'readiness', label: 'Data Health' },
];

// ── Shared helpers ─────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function fmtAge(iso) {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'just now';
    const h = Math.floor(ms / 3_600_000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h ago`;
    if (h > 0) return `${h}h ago`;
    const m = Math.floor(ms / 60_000);
    return m > 0 ? `${m}m ago` : 'just now';
  } catch {
    return String(iso);
  }
}

function StatusBadge({ value }) {
  const map = {
    success: 'bg-emerald-50 text-emerald-700',
    failed: 'bg-rose-50 text-rose-700',
    running: 'bg-blue-50 text-blue-700',
    queued: 'bg-blue-50 text-blue-600',
    skipped: 'bg-slate-100 text-slate-500',
    completed: 'bg-emerald-50 text-emerald-700',
    enabled: 'bg-emerald-50 text-emerald-700',
    scheduled: 'bg-emerald-50 text-emerald-700',
    disabled: 'bg-slate-100 text-slate-500',
    'not scheduled': 'bg-slate-100 text-slate-500',
    paused: 'bg-amber-50 text-amber-700',
    pending: 'bg-slate-100 text-slate-400',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        map[String(value)] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {String(value)}
    </span>
  );
}

function SourceSelect({ value, onChange, includeAll = false }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
    >
      {includeAll && <option value="">All sources</option>}
      {SOURCES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, error, refetch, isFetching } = useIngestionStatus();
  const sources = data?.sources ?? [];

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-slate-500">Loading status…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        Failed to load status: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">Updated {data?.ts ? fmtTime(data.ts) : '—'}</p>
        <button
          type="button"
          disabled={isFetching}
          onClick={() => refetch()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Schedule</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Interval</th>
              <th className="px-4 py-3">Last run</th>
              <th className="px-4 py-3">Last success</th>
              <th className="px-4 py-3">Last error</th>
              <th className="px-4 py-3">Staging docs</th>
              <th className="px-4 py-3">Stale?</th>
              <th className="px-4 py-3">Records written</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
            {sources.map((s) => {
              const schedStatus = s.schedule?.paused
                ? 'paused'
                : s.enabled
                  ? 'scheduled'
                  : 'not scheduled';

              return (
                <tr key={s.source} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">
                    {s.source}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge value={schedStatus} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{s.mode ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {s.schedule?.strategy ?? '—'}
                    {s.schedule?.interval_minutes
                      ? ` / ${s.schedule.interval_minutes}m`
                      : null}
                    {s.schedule?.run_times?.length
                      ? ` @ ${s.schedule.run_times.join(', ')}`
                      : null}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {s.last_run ? (
                      <span title={fmtTime(s.last_run.started_at)}>
                        <StatusBadge value={s.last_run.status} />
                        <span className="ml-1 text-slate-400">
                          {fmtAge(s.last_run.started_at)}
                        </span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {fmtAge(s.last_success?.started_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-rose-500">
                    {s.last_error ? fmtAge(s.last_error.started_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {s.staging_count != null
                      ? s.staging_count.toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {s.stale === true ? (
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        ⚠ Stale
                      </span>
                    ) : s.stale === false ? (
                      <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        OK
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {s.last_run?.records_written ?? '—'}
                  </td>
                </tr>
              );
            })}
            {sources.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                  No status data yet. Run a health check to populate.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Manual Run tab ────────────────────────────────────────────────────────────

function ManualRunTab() {
  const [source, setSource] = useState('galveston');
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState(20);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [output, setOutput] = useState(null);
  const [awaitConfirm, setAwaitConfirm] = useState(false);

  const { mutate, mutateAsync, isPending } = useTriggerRun();
  const BULK_SOURCES = ['galveston', 'harris_reports', 'wharton', 'jefferson_lookup', 'fortbend_lookup'];
  const [bulkProgress, setBulkProgress] = useState(null); // null | array
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkFortBendJobId, setBulkFortBendJobId] = useState(null);
  const bulkFortBendPollRef = useRef(null);

  async function handleRunAll() {
    // Reset any prior Fort Bend poll
    if (bulkFortBendPollRef.current) { clearInterval(bulkFortBendPollRef.current); bulkFortBendPollRef.current = null; }
    setBulkFortBendJobId(null);
    setBulkProgress([
      ...BULK_SOURCES.map((s) => ({ source: s, status: 'pending', seen: null, written: null, error: null, date_searched: null })),
      { source: 'brazoria_lookup', status: 'skipped', seen: null, written: null, error: 'Requires name + first_name' },
    ]);
    setBulkRunning(true);
    let fortBendQueued = false;
    for (const src of BULK_SOURCES) {
      setBulkProgress((prev) => prev.map((p) => p.source === src ? { ...p, status: 'running' } : p));
      try {
        const isFortbend = src === 'fortbend_lookup';
        const isJeffersonBulk = src === 'jefferson_lookup';
        const payload = isFortbend
          ? { source: src, dry_run: dryRun, discoveryMode: 'auto', windowDays: 7, limit: 0, bulk: true }
          : isJeffersonBulk
            ? { source: src, dry_run: dryRun, limit: 100, booking_date: 'today', bulk: true }
            : { source: src, dry_run: dryRun, limit: 100, bulk: true };
        const result = await mutateAsync(payload);
        if (isFortbend && result.job_id) {
          // Async job queued — start polling
          fortBendQueued = true;
          setBulkFortBendJobId(result.job_id);
          setBulkProgress((prev) => prev.map((p) => p.source === src ? {
            ...p,
            status: 'queued',
            job_id: result.job_id,
            prefixes_checked: 0,
            prefixes_total: 676,
            percent_complete: 0,
            current_prefix: null,
            elapsed_seconds: 0,
            estimated_seconds_remaining: null,
          } : p));
        } else {
          setBulkProgress((prev) => prev.map((p) => p.source === src ? {
            ...p,
            status: result.ok ? 'completed' : 'failed',
            seen:          result.records_seen ?? null,
            written:       result.records_written ?? null,
            date_searched: result.date_searched ?? null,
            error:   !result.ok ? (result.message || 'Run failed') : null,
          } : p));
        }
      } catch (err) {
        let msg = err.message;
        try { const b = JSON.parse(err.message.replace(/^Request failed \d+: /, '')); if (b?.message) msg = b.message; } catch { /* raw */ }
        setBulkProgress((prev) => prev.map((p) => p.source === src ? { ...p, status: 'failed', error: msg } : p));
      }
    }
    // Keep bulkRunning=true while Fort Bend async job is running; poll useEffect clears it
    if (!fortBendQueued) setBulkRunning(false);
  }

  // Poll Fort Bend bulk auto-discovery job
  useEffect(() => {
    if (!bulkFortBendJobId) return;
    const poll = async () => {
      try {
        const data = await getJSON(`/admin/ingestion/jobs/${bulkFortBendJobId}`);
        if (data?.job) {
          const j = data.job;
          setBulkProgress((prev) => prev.map((p) => p.source === 'fortbend_lookup' ? {
            ...p,
            status: j.status,
            job_id: bulkFortBendJobId,
            prefixes_checked: j.prefixes_checked ?? 0,
            prefixes_total: j.prefixes_total ?? 676,
            percent_complete: j.percent_complete ?? 0,
            current_prefix: j.current_prefix ?? null,
            elapsed_seconds: j.elapsed_seconds ?? 0,
            estimated_seconds_remaining: j.estimated_seconds_remaining ?? null,
            seen: j.seen ?? 0,
            written: j.written ?? 0,
            details_checked: j.details_checked ?? null,
            recent_matches: j.recent_matches ?? null,
            prefixes_total: j.prefixes_total ?? 676,
            completed_full_sweep: j.completed_full_sweep ?? false,
            error: ['failed', 'cancelled'].includes(j.status) ? (j.stderr_tail || 'Fort Bend discovery failed') : null,
          } : p));
          if (['completed', 'failed', 'cancelled'].includes(j.status)) {
            clearInterval(bulkFortBendPollRef.current);
            bulkFortBendPollRef.current = null;
            setBulkFortBendJobId(null);
            setBulkRunning(false);
          }
        }
      } catch (err) {
        console.error('[bulk fortbend poll]', err);
      }
    };
    poll();
    bulkFortBendPollRef.current = setInterval(poll, 3000);
    return () => { if (bulkFortBendPollRef.current) clearInterval(bulkFortBendPollRef.current); };
  }, [bulkFortBendJobId]);

  const isLookup = LOOKUP_SOURCES.has(source);
  const isJefferson = source === 'jefferson_lookup';
  const isBrazoria = source === 'brazoria_lookup';
  const supportsBookingDate = isJefferson || isBrazoria;
  const missingLastName = isLookup && !lastName.trim() && !(isJefferson && bookingDate.trim());
  const missingFirstName = isBrazoria && !firstName.trim();

  // Reset confirmation + output when key inputs change
  function handleSourceChange(val) {
    setSource(val);
    setAwaitConfirm(false);
    setOutput(null);
    setLastName('');
    setFirstName('');
    setBookingDate('');
  }

  function handleDryRunChange(checked) {
    setDryRun(checked);
    setAwaitConfirm(false);
  }

  function handleRun() {
    // Non-dry-run: require explicit second click to confirm
    if (!dryRun && !awaitConfirm) {
      setAwaitConfirm(true);
      return;
    }
    setAwaitConfirm(false);
    setOutput(null);

    mutate(
      {
        source,
        dry_run: dryRun,
        limit,
        first_name: firstName,
        last_name: lastName,
        booking_date: bookingDate,
      },
      {
        onSuccess: (data) => setOutput(data),
        onError: (err) => {
          // Surface the backend error message (never includes secrets — backend redacts them)
          let msg = err.message;
          try {
            const body = JSON.parse(err.message.replace(/^Request failed \d+: /, ''));
            if (body?.message) msg = body.message;
          } catch {
            // use raw message
          }
          setOutput({ ok: false, message: msg });
        },
      },
    );
  }

  const buttonLabel = isPending
    ? 'Running…'
    : awaitConfirm
      ? 'Confirm — write to staging'
      : 'Run Selected Source';

  const buttonClass = isPending || missingLastName || missingFirstName
    ? 'cursor-not-allowed opacity-50 rounded-lg px-4 py-2 text-sm font-semibold border border-slate-300 bg-slate-100 text-slate-400'
    : awaitConfirm
      ? 'rounded-lg border border-amber-400 bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-200'
      : dryRun
        ? 'rounded-lg border border-blue-400 bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700'
        : 'rounded-lg border border-amber-500 bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700';

  return (
    <div className="space-y-6">

      {/* ─ Run All Counties Now ──────────────────────────────── */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-blue-800">Run All Counties Now</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Runs Galveston, Harris, Wharton, Jefferson, and Fort Bend full discovery sweep (aa–zz).
              Brazoria remains lookup-only — requires real first and last names.
              {dryRun
                ? ' Dry run ON — no records will be written.'
                : ' Writes to staging collections.'}
            </p>
          </div>
          <button
            type="button"
            disabled={bulkRunning || isPending}
            onClick={handleRunAll}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold ${
              bulkRunning || isPending
                ? 'bg-blue-400 text-white cursor-not-allowed opacity-70'
                : dryRun
                  ? 'border border-blue-400 bg-blue-600 text-white hover:bg-blue-700'
                  : 'border border-blue-600 bg-blue-700 text-white hover:bg-blue-800'
            }`}
          >
            {bulkRunning ? 'Running…' : 'Run Daily Bulk Scrapers Now'}
          </button>
        </div>

        {/* Bulk run progress */}
        {bulkProgress && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            {(() => {
              const completed    = bulkProgress.filter((r) => r.status === 'completed').length;
              const failed       = bulkProgress.filter((r) => r.status === 'failed').length;
              const totalWritten = bulkProgress
                .filter((r) => r.status === 'completed')
                .reduce((s, r) => s + (r.written ?? 0), 0);
              if (bulkRunning) {
                return <p className="text-xs font-semibold text-blue-700">Running bulk scrapers…</p>;
              }
              if (failed > 0) {
                return <p className="text-xs font-semibold text-amber-700">⚠ Bulk run finished with issues — {failed} source{failed > 1 ? 's' : ''} failed</p>;
              }
              return (
                <p className="text-xs font-semibold text-emerald-700">
                  {dryRun
                    ? `✓ Dry run complete — no records written`
                    : `✓ Bulk run complete${totalWritten > 0 ? ` — ${totalWritten} records written` : ' — all records up to date'}`}
                </p>
              );
            })()}
            {bulkProgress.map((r) => (
              <div key={r.source} className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <StatusBadge value={r.status} />
                  <span className="font-mono text-xs text-slate-700">{r.source}</span>
                  {r.status === 'running' && r.source !== 'fortbend_lookup' && (
                    <span className="text-xs text-blue-500 animate-pulse">running…</span>
                  )}
                  {(r.status === 'queued' || (r.status === 'running' && r.source === 'fortbend_lookup')) && (
                    <span className="text-xs text-blue-500 animate-pulse">
                      {r.status === 'queued' ? 'starting full sweep…' : `scanning${r.current_prefix ? ` prefix ${r.current_prefix}` : '…'}`}
                    </span>
                  )}
                  {r.status === 'pending' && (
                    <span className="text-xs text-slate-400">waiting</span>
                  )}
                  {r.status === 'completed' && (
                    <span className="text-xs text-emerald-600">
                      {r.source === 'fortbend_lookup'
                        ? (() => {
                            const checked = r.prefixes_checked ?? 0;
                            const total = r.prefixes_total ?? 676;
                            const fullSweep = r.completed_full_sweep || checked >= total;
                            const prefixSummary = fullSweep
                              ? `full sweep ${checked}/${total} prefixes`
                              : checked > 0
                                ? `partial — ${checked}/${total} prefixes checked`
                                : null;
                            if (fullSweep && (r.written ?? 0) > 0)
                              return `✅ Fort Bend ${prefixSummary} — wrote ${r.written}${r.details_checked != null ? ` (${r.details_checked} details, ${r.recent_matches ?? 0} matched)` : ''}`;
                            if (fullSweep)
                              return `✅ Fort Bend ${prefixSummary}${r.details_checked != null ? ` — ${r.details_checked} details, ${r.seen ?? 0} seen` : ''}`;
                            if (prefixSummary && (r.written ?? 0) > 0)
                              return `⚠ Fort Bend ${prefixSummary} — wrote ${r.written}`;
                            if (prefixSummary)
                              return `⚠ Fort Bend ${prefixSummary} — seen ${r.seen ?? 0}`;
                            return dryRun
                              ? `seen ${r.seen ?? 0}, ${r.details_checked ?? 0} details checked`
                              : `seen ${r.seen ?? 0} — all up to date (${r.details_checked ?? 0} details checked)`;
                          })()
                        : ((r.written ?? 0) > 0
                          ? `✅ wrote ${r.written}${r.date_searched ? ` — date ${r.date_searched}` : ''}`
                          : dryRun
                            ? `seen ${r.seen != null ? r.seen : 'unavailable'}${r.date_searched ? ` (${r.date_searched})` : ''}`
                            : `seen ${r.seen != null ? r.seen : 'unavailable'} (all up to date)${r.date_searched ? ` — ${r.date_searched}` : ''}`)}
                    </span>
                  )}
                  {r.status === 'failed' && r.error && (
                    <span className="text-xs text-rose-600 truncate max-w-xs" title={r.error}>{r.error}</span>
                  )}
                  {r.status === 'skipped' && (
                    <span className="text-xs text-slate-400">{r.error}</span>
                  )}
                </div>
                {/* Fort Bend inline job progress (while queued or running) */}
                {r.source === 'fortbend_lookup' && ['queued', 'running'].includes(r.status) && (
                  <div className="ml-6 space-y-1.5 rounded border border-blue-100 bg-blue-50 px-3 py-2">
                    <div className="w-full bg-blue-200 rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: (r.percent_complete || 0) + '%' }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-blue-700">
                      {r.current_prefix && <span>Current prefix: <strong>{r.current_prefix}</strong></span>}
                      <span>Prefixes: {r.prefixes_checked || 0} / {r.prefixes_total || 676} ({(r.percent_complete || 0).toFixed(1)}%)</span>
                      {r.elapsed_seconds > 0 && <span>Elapsed: {Math.floor(r.elapsed_seconds / 60)}m {Math.round(r.elapsed_seconds % 60)}s</span>}
                      {r.estimated_seconds_remaining != null && <span>ETA: ~{Math.floor(r.estimated_seconds_remaining / 60)}m</span>}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-blue-600">
                      <span>Seen: {r.seen || 0}</span>
                      {r.details_checked != null && <span>Details: {r.details_checked}</span>}
                      {r.recent_matches != null && <span>Matched: {r.recent_matches}</span>}
                      {(r.written ?? 0) > 0 && <span className="text-emerald-600 font-semibold">Written: {r.written}</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─ Dry-run toggle (shared between run-all and individual) ─ */}
      <div className="space-y-2">
        <label className="flex cursor-pointer select-none items-center gap-3">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => handleDryRunChange(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-blue-600"
          />
          <span className="text-sm text-slate-700">
            Dry run only — <span className="text-slate-400">test scraper without saving records</span>
          </span>
        </label>
        {dryRun && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            Dry run is ON. No database records will be written.
          </div>
        )}
      </div>

      {/* ─ Run Individual Source ───────────────────────────────── */}
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Run Individual Source</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Source
          </label>
          <SourceSelect value={source} onChange={handleSourceChange} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Limit
          </label>
          <input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value))))}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          />
        </div>

        {isLookup && (
          <>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Last name{!isJefferson && <span className="text-rose-500"> *</span>}
                {isJefferson && <span className="text-slate-400"> (or use date)</span>}
                {isBrazoria && <span className="text-rose-500"> *</span>}
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="SMITH"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                First name{isBrazoria && <span className="text-rose-500"> *</span>}
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={isBrazoria ? 'JOHN' : 'Optional'}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
              />
            </div>
            {supportsBookingDate && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Booking date{' '}
                  {isJefferson
                    ? <span className="text-slate-400">(or use name)</span>
                    : <span className="text-slate-400">(additive filter)</span>}
                </label>
                <input
                  type="date"
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Non-dry-run warning */}
      {!dryRun && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>⚠ Warning:</strong> Dry-run is disabled. This run will write records to the
          staging collection. Production collection writes are blocked at the API layer.
          {awaitConfirm && (
            <span className="ml-1">Click <strong>Confirm — write to staging</strong> to proceed.</span>
          )}
        </div>
      )}

      {/* Run button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending || missingLastName}
          onClick={handleRun}
          className={buttonClass}
        >
          {buttonLabel}
        </button>

        {awaitConfirm && (
          <button
            type="button"
            onClick={() => setAwaitConfirm(false)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400"
          >
            Cancel
          </button>
        )}

        {missingLastName && (
          <span className="text-xs text-rose-500">
            {source === 'jefferson_lookup'
              ? 'Provide a last name or booking date'
              : 'Last name is required for lookup sources'}
          </span>
        )}
        {missingFirstName && (
          <span className="text-xs text-rose-500">
            First name is required for brazoria_lookup
          </span>
        )}
      </div>

      {/* Output console */}
      {output && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            <StatusBadge value={output.ok ? 'success' : 'failed'} />
            {output.command && (
              <code className="text-xs text-slate-400">{output.command}</code>
            )}
            {output.dry_run != null && (
              <span className="text-xs text-slate-400">
                {output.dry_run ? '(dry-run)' : '(staging write)'}
              </span>
            )}
          </div>

          {/* Backend error message */}
          {output.message && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {output.message}
            </div>
          )}

          {/* stdout */}
          {output.stdout_tail && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                stdout
              </div>
              <pre className="max-h-72 overflow-y-auto rounded-xl bg-slate-900 px-4 py-3 text-xs leading-relaxed text-emerald-300 whitespace-pre-wrap">
                {output.stdout_tail}
              </pre>
            </div>
          )}

          {/* stderr */}
          {output.stderr_tail && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                stderr
              </div>
              <pre className="max-h-40 overflow-y-auto rounded-xl bg-slate-900 px-4 py-3 text-xs leading-relaxed text-amber-300 whitespace-pre-wrap">
                {output.stderr_tail}
              </pre>
            </div>
          )}

          {/* Summary stats */}
          {(output.records_written != null || output.records_seen != null) && (
            <div className={`rounded-lg border px-3 py-2 ${
              output.ok
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-rose-200 bg-rose-50'
            }`}>
              <p className={`text-xs font-semibold mb-1 ${
                output.ok ? 'text-emerald-700' : 'text-rose-700'
              }`}>
                {output.ok
                  ? output.dry_run ? '✓ Dry run completed' : '✓ Run completed'
                  : '✕ Run failed'}
              </p>
              <div className={`flex gap-4 text-xs ${
                output.ok ? 'text-emerald-700' : 'text-rose-700'
              }`}>
                {output.records_seen != null && <span>Seen: <strong>{output.records_seen}</strong></span>}
                {output.records_written != null && <span>Written: <strong>{output.records_written}</strong></span>}
                {output.dry_run && output.records_written === 0 && (
                  <span className="opacity-70">No records were saved.</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Lookup Discovery tab ──────────────────────────────────────────────────────

function FortBendDiscoveryTab() {
  const [mode, setMode] = useState('prefix');
  const [firstPrefix, setFirstPrefix] = useState('a');
  const [lastPrefix, setLastPrefix] = useState('a');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [windowDays, setWindowDays] = useState(7);
  const [limit, setLimit] = useState(25);
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [verifySample, setVerifySample] = useState(5);

  const [jobId, setJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(null);
  const pollingRef = useRef(null);

  const triggerRun = useTriggerRun();
  const cancelJob = useCancelJob();
  const running = triggerRun.isPending || (jobProgress && ['queued', 'running'].includes(jobProgress.status));

  const buildPayload = (modeOverride) => {
    const effectiveMode = modeOverride ?? mode;
    const usePrefix = effectiveMode === 'prefix' || effectiveMode === 'verify';
    return {
      source: 'fortbend_lookup',
      dry_run: dryRun,
      limit,
      discoveryMode: effectiveMode,
      firstPrefix: usePrefix ? firstPrefix : '',
      lastPrefix: usePrefix ? lastPrefix : '',
      first_name: effectiveMode === 'name' ? firstName : '',
      last_name: effectiveMode === 'name' ? lastName : '',
      windowDays,
      ...(effectiveMode === 'verify' ? { verifySample } : {}),
    };
  };

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const data = await getJSON(`/admin/ingestion/jobs/${jobId}`);
        if (data?.job) {
          setJobProgress(data.job);
          if (['completed', 'failed', 'cancelled'].includes(data.job.status)) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
            if (data.job.status === 'completed') {
              setResult({ ok: true, ...data.job });
            } else {
              setResult({ ok: false, message: `Auto discovery ${data.job.status}` });
            }
            setJobProgress(null);
          }
        }
      } catch (err) {
        console.error('[FortBendDiscovery] poll error:', err);
      }
    };
    poll();
    pollingRef.current = setInterval(poll, 3000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [jobId]);

  const handleRun = (modeOverride) => {
    const effectiveMode = modeOverride ?? mode;
    if (!dryRun && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    setResult(null);
    setJobId(null);
    setJobProgress(null);
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    triggerRun.mutate(buildPayload(effectiveMode), {
      onSuccess: (data) => {
        if (data.job_id) {
          setJobId(data.job_id);
          setJobProgress({ job_id: data.job_id, status: data.status || 'queued',
            prefixes_total: 676, prefixes_checked: 0, percent_complete: 0 });
        } else {
          setResult(data);
        }
      },
      onError: (err) => setResult({ ok: false, message: err.message || 'Request failed' }),
    });
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-1">Fort Bend Lookup Discovery</h3>
        <p className="text-sm text-gray-500">
          Search Fort Bend jail records, filter by recency window, and cache stale profiles.
        </p>
      </div>

      {/* Mode selector */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Mode</label>
        <div className="flex gap-2 flex-wrap">
          {['prefix', 'name', 'seed', 'auto', 'verify'].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                mode === m
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {m === 'auto' ? 'Auto (aa–zz)' : m === 'verify' ? 'Verify Detail Parsing' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Prefix inputs */}
      {mode === 'prefix' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">First Name Prefix</label>
            <input
              type="text"
              value={firstPrefix}
              onChange={(e) => setFirstPrefix(e.target.value)}
              placeholder="e.g. a"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Last Name Prefix</label>
            <input
              type="text"
              value={lastPrefix}
              onChange={(e) => setLastPrefix(e.target.value)}
              placeholder="e.g. a"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
        </div>
      )}

      {/* Name inputs */}
      {mode === 'name' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Last Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="e.g. SMITH"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="optional"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
        </div>
      )}

      {/* Seed description */}
      {mode === 'seed' && (
        <p className="text-sm text-gray-600 bg-gray-50 rounded p-3 border border-gray-200">
          Seed mode pulls names from recent Galveston, Harris, and Wharton bulk records (last 30 days) and searches Fort Bend for matches.
        </p>
      )}

      {/* Auto mode description */}
      {mode === 'auto' && (
        <p className="text-sm text-gray-600 bg-blue-50 rounded p-3 border border-blue-200">
          Auto mode iterates all 676 first×last prefix combinations (aa through zz), checking the stale
          cache before fetching each detail page. Use <strong>Result Limit</strong> to cap total rows processed.
        </p>
      )}

      {/* Verify mode inputs */}
      {mode === 'verify' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 bg-purple-50 rounded p-3 border border-purple-200">
            Verify mode opens real detail pages and emits evidence for each, confirming what fields are
            parsed, what booking-date logic applies, and what the write decision would be. No records are
            written regardless of the dry-run setting.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First Name Prefix</label>
              <input
                type="text"
                value={firstPrefix}
                onChange={(e) => setFirstPrefix(e.target.value)}
                placeholder="e.g. a"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Name Prefix</label>
              <input
                type="text"
                value={lastPrefix}
                onChange={(e) => setLastPrefix(e.target.value)}
                placeholder="e.g. a"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sample Size</label>
              <input
                type="number"
                min={1}
                max={25}
                value={verifySample}
                onChange={(e) => setVerifySample(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Window + limit */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Recency Window (days)</label>
          <input
            type="number"
            min={1}
            max={90}
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Result Limit</label>
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Dry run toggle */}
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => { setDryRun(e.target.checked); setConfirming(false); }}
          className="rounded"
        />
        <span className="font-medium">Dry run</span>
        <span className="text-gray-500">(no writes)</span>
      </label>

      {/* Confirm warning */}
      {confirming && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-sm text-yellow-800">
          <strong>Live write mode.</strong> This will write records to MongoDB. Click Run again to confirm.
        </div>
      )}

      {/* Run button */}
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => handleRun()}
          disabled={running || (mode === 'name' && !lastName)}
          className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-indigo-700 transition-colors"
        >
          {running ? 'Running…' : confirming ? 'Confirm Run (live write)' : 'Run Discovery'}
        </button>
        {/* Prominent quick-launch for auto mode */}
        <button
          onClick={() => handleRun('auto')}
          disabled={running}
          className="px-4 py-2 rounded bg-green-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-green-700 transition-colors"
        >
          {running && (mode === 'auto' || jobProgress) ? 'Running Auto Discovery…' : 'Run Automated Discovery (aa–zz)'}
        </button>
      </div>

      {/* Progress card (while auto job is running) */}
      {jobProgress && ['queued', 'running'].includes(jobProgress.status) && (
        <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-blue-800">
              Auto Discovery — {jobProgress.status === 'queued' ? 'Starting…' : 'Running'}
            </span>
            <button
              onClick={() => cancelJob.mutate(jobId)}
              className="px-3 py-1 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
            >
              Cancel
            </button>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-500"
              style={{ width: (jobProgress.percent_complete || 0) + '%' }}
            />
          </div>
          <div className="flex justify-between text-xs text-blue-700 mb-2">
            <span>{jobProgress.prefixes_checked || 0} / {jobProgress.prefixes_total || 676} prefixes</span>
            <span>{(jobProgress.percent_complete || 0).toFixed(1)}%</span>
            {jobProgress.current_prefix && <span>Current: <strong>{jobProgress.current_prefix}</strong></span>}
          </div>
          <div className="flex gap-4 text-xs text-blue-600 mb-2">
            {jobProgress.elapsed_seconds > 0 && (
              <span>Elapsed: {Math.floor(jobProgress.elapsed_seconds / 60)}m {Math.round(jobProgress.elapsed_seconds % 60)}s</span>
            )}
            {jobProgress.estimated_seconds_remaining != null && (
              <span>ETA: ~{Math.floor(jobProgress.estimated_seconds_remaining / 60)}m {Math.round(jobProgress.estimated_seconds_remaining % 60)}s</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {[
              ['Seen', jobProgress.seen],
              ['Matched', jobProgress.recent_matches],
              ['Written', jobProgress.written],
              ['Errors', jobProgress.errors],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded border border-blue-200 p-1.5 text-center">
                <div className="font-bold text-gray-900">{val ?? 0}</div>
                <div className="text-gray-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result card */}
      {result && !result.verification_details && (
        <div className={`rounded border p-4 text-sm ${result.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="font-semibold mb-2">{result.ok ? '✓ Completed' : '✗ Failed'}</div>
          {result.message && <p className="text-gray-700 mb-3">{result.message}</p>}
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              ['Prefixes Checked', result.prefixes_checked],
              ['Seen', result.seen],
              ['Details Checked', result.details_checked],
              ['Recent Matches', result.recent_matches],
              ['Written', result.written],
              ['Stale Cached', result.stale_cached],
              ['Skipped (cached)', result.skipped_cached],
              ['Skipped (no URL)', result.skipped],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded border border-gray-200 p-2 text-center">
                <div className="font-bold text-gray-900">{val ?? '—'}</div>
                <div className="text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          {result.dry_run && (
            <p className="text-xs text-gray-500 mt-2 italic">Dry run — no records were written.</p>
          )}
        </div>
      )}

      {/* Verify result card */}
      {result && result.verification_details && (
        <div className={`rounded border p-4 text-sm ${result.ok ? 'bg-purple-50 border-purple-200' : 'bg-red-50 border-red-200'}`}>
          <div className="font-semibold mb-2">{result.ok ? '✓ Verify Completed' : '✗ Verify Failed'}</div>
          {result.message && <p className="text-gray-700 mb-2">{result.message}</p>}
          <div className="grid grid-cols-5 gap-2 text-xs mb-4">
            {[
              ['Seen', result.seen],
              ['Details Checked', result.details_checked],
              ['Recent / Unknown', result.recent_matches],
              ['Stale', result.stale_cached],
              ['Unknown Date', result.unknown_date],
            ].map(([label, val]) => (
              <div key={label} className="bg-white rounded border border-purple-200 p-2 text-center">
                <div className="font-bold text-gray-900">{val ?? '—'}</div>
                <div className="text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mb-2 italic">
            Fort Bend does not expose booking dates — all records show <code>not_found</code> and are treated as current roster.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-purple-100 text-purple-800">
                  <th className="text-left px-2 py-1 border border-purple-200">#</th>
                  <th className="text-left px-2 py-1 border border-purple-200">Name</th>
                  <th className="text-left px-2 py-1 border border-purple-200">Booking Date</th>
                  <th className="text-left px-2 py-1 border border-purple-200">Within Window</th>
                  <th className="text-left px-2 py-1 border border-purple-200">Decision</th>
                  <th className="text-left px-2 py-1 border border-purple-200">Charges</th>
                  <th className="text-left px-2 py-1 border border-purple-200">Bond</th>
                  <th className="text-left px-2 py-1 border border-purple-200">Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.verification_details.map((d) => {
                  const decisionColor = {
                    would_write_event: 'text-green-700 bg-green-50',
                    would_cache_stale: 'text-yellow-700 bg-yellow-50',
                    would_skip_cached: 'text-blue-700 bg-blue-50',
                    error:             'text-red-700 bg-red-50',
                  }[d.decision] ?? 'text-gray-700 bg-gray-50';
                  return (
                    <tr key={d.index} className="hover:bg-purple-50">
                      <td className="px-2 py-1 border border-purple-100 text-gray-500">{d.index}</td>
                      <td className="px-2 py-1 border border-purple-100 font-medium">{d.full_name || '—'}</td>
                      <td className="px-2 py-1 border border-purple-100 text-gray-500">
                        {d.booking_date ?? <span className="italic text-gray-400">not found</span>}
                      </td>
                      <td className="px-2 py-1 border border-purple-100 text-center">
                        {d.within_window == null ? <span className="text-gray-400">—</span>
                          : d.within_window ? <span className="text-green-600">✓</span>
                          : <span className="text-red-500">✗</span>}
                      </td>
                      <td className={`px-2 py-1 border border-purple-100 rounded-sm font-medium ${decisionColor}`}>
                        {d.decision}
                      </td>
                      <td className="px-2 py-1 border border-purple-100 text-center">{d.charges_count ?? 0}</td>
                      <td className="px-2 py-1 border border-purple-100">
                        {d.first_bond_amount != null ? `$${d.first_bond_amount}` : '—'}
                      </td>
                      <td className="px-2 py-1 border border-purple-100">
                        {d.detail_url
                          ? <a href={d.detail_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">view</a>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scheduler tab ─────────────────────────────────────────────────────────────

function SchedulerForm({ source, cfg, onSave, saving, onPause, onResume, pausing, resuming }) {
  const [enabled, setEnabled] = useState(cfg?.enabled ?? false);
  const [intervalMinutes, setIntervalMinutes] = useState(
    cfg?.schedule?.interval_minutes != null ? String(cfg.schedule.interval_minutes) : '',
  );
  const [runTimes, setRunTimes] = useState(
    (cfg?.schedule?.run_times ?? []).join(', '),
  );
  const [skipWeekends, setSkipWeekends] = useState(cfg?.schedule?.skip_weekends ?? false);
  const [maxRunsPerDay, setMaxRunsPerDay] = useState(
    cfg?.schedule?.max_runs_per_day != null ? String(cfg.schedule.max_runs_per_day) : '',
  );

  const isPaused = cfg?.schedule?.paused ?? false;

  function buildPatch() {
    const schedulePatch = { skip_weekends: skipWeekends };
    if (intervalMinutes !== '') schedulePatch.interval_minutes = Number(intervalMinutes);
    if (maxRunsPerDay !== '') schedulePatch.max_runs_per_day = Number(maxRunsPerDay);
    if (runTimes.trim()) {
      schedulePatch.run_times = runTimes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return { enabled, schedule: schedulePatch };
  }

  return (
    <div className="space-y-5">
      {/* Config grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Enabled */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Enabled
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-blue-600"
            />
            <span className="text-sm text-slate-700">
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>

        {/* Interval minutes */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Interval minutes{' '}
            <span className="font-normal normal-case text-slate-400">(interval strategy)</span>
          </label>
          <input
            type="number"
            min={1}
            max={1440}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(e.target.value)}
            placeholder="e.g. 15"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* Run times */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Run times{' '}
            <span className="font-normal normal-case text-slate-400">
              (run_times strategy, HH:MM comma-separated)
            </span>
          </label>
          <input
            type="text"
            value={runTimes}
            onChange={(e) => setRunTimes(e.target.value)}
            placeholder="01:00, 13:00"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          />
        </div>

        {/* Skip weekends */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Skip weekends
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={skipWeekends}
              onChange={(e) => setSkipWeekends(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-blue-600"
            />
            <span className="text-sm text-slate-700">Skip Sat &amp; Sun</span>
          </label>
        </div>

        {/* Max runs per day */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Max runs / day
          </label>
          <input
            type="number"
            min={0}
            max={1440}
            value={maxRunsPerDay}
            onChange={(e) => setMaxRunsPerDay(e.target.value)}
            placeholder="96"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Raw config */}
      {cfg && (
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700">
            Current stored config (raw)
          </summary>
          <pre className="overflow-x-auto px-4 py-3 text-xs text-slate-600">
            {JSON.stringify(cfg, null, 2)}
          </pre>
        </details>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(buildPatch())}
          className="rounded-lg border border-blue-400 bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        <button
          type="button"
          disabled={pausing || isPaused}
          onClick={() => onPause(source)}
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          {pausing ? 'Pausing…' : 'Pause'}
        </button>

        <button
          type="button"
          disabled={resuming || !isPaused}
          onClick={() => onResume(source)}
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
        >
          {resuming ? 'Resuming…' : 'Resume'}
        </button>

        {isPaused && (
          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            paused
          </span>
        )}
      </div>

      <p className="text-xs text-slate-400">
        ⚠ Schedule changes are stored in MongoDB and take effect on the next cron tick. The Render
        cron cadence itself requires a <code>render.yaml</code> redeploy to change.
      </p>
    </div>
  );
}

function SchedulerTab({ onSaved }) {
  const [source, setSource] = useState('galveston');
  const [saveMsg, setSaveMsg] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  const { data, isLoading, error } = useIngestionConfig({ source });
  const { mutate: updateConfig, isPending: saving } = useUpdateIngestionConfig();
  const { mutate: pauseSource, isPending: pausing } = usePauseSource();
  const { mutate: resumeSource, isPending: resuming } = useResumeSource();

  const configs = data?.configs ?? [];
  const cfg = configs.find((c) => c.source === source) ?? null;

  // Clear status messages when source changes
  useEffect(() => {
    setSaveMsg(null);
    setActionMsg(null);
  }, [source]);

  function handleSave(patch) {
    setSaveMsg(null);
    updateConfig(
      { source, patch },
      {
        onSuccess: () => {
          setSaveMsg({ ok: true, text: `✓ Schedule saved for ${source}. Open the Overview tab to see the updated schedule status.` });
          if (onSaved) setTimeout(onSaved, 1200);
        },
        onError: (err) => {
          let msg = err.message;
          try {
            const body = JSON.parse(err.message.replace(/^Request failed \d+: /, ''));
            if (body?.message) msg = body.message;
          } catch {
            // use raw message
          }
          setSaveMsg({ ok: false, text: msg });
        },
      },
    );
  }

  function handlePause(src) {
    setActionMsg(null);
    pauseSource(src, {
      onSuccess: () => setActionMsg({ ok: true, text: `${src} paused.` }),
      onError: (err) => {
        let msg = err.message;
        try {
          const body = JSON.parse(err.message.replace(/^Request failed \d+: /, ''));
          if (body?.message) msg = body.message;
        } catch { /* raw */ }
        setActionMsg({ ok: false, text: msg });
      },
    });
  }

  function handleResume(src) {
    setActionMsg(null);
    resumeSource(src, {
      onSuccess: () => setActionMsg({ ok: true, text: `${src} resumed.` }),
      onError: (err) => {
        let msg = err.message;
        try {
          const body = JSON.parse(err.message.replace(/^Request failed \d+: /, ''));
          if (body?.message) msg = body.message;
        } catch { /* raw */ }
        setActionMsg({ ok: false, text: msg });
      },
    });
  }

  return (
    <div className="space-y-5">
      {/* Source selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Source
        </label>
        <SourceSelect value={source} onChange={setSource} />
      </div>

      {isLoading && (
        <div className="py-4 text-sm text-slate-500">Loading config…</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Failed to load config: {error.message}
        </div>
      )}

      {!isLoading && (
        <SchedulerForm
          key={source}
          source={source}
          cfg={cfg}
          onSave={handleSave}
          saving={saving}
          onPause={handlePause}
          onResume={handleResume}
          pausing={pausing}
          resuming={resuming}
        />
      )}

      {saveMsg && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            saveMsg.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {saveMsg.text}
        </div>
      )}

      {actionMsg && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            actionMsg.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {actionMsg.text}
        </div>
      )}
    </div>
  );
}

// ── Runs / Errors tab ─────────────────────────────────────────────────────────

function RunsTab({ mode }) {
  const [source, setSource] = useState('');
  const [limit, setLimit] = useState(50);

  // Both hooks always called — only one is enabled at a time
  const isErrors = mode === 'errors';
  const runsResult = useIngestionRuns({ source, limit }, { enabled: !isErrors });
  const errorsResult = useIngestionErrors({ source, limit }, { enabled: isErrors });

  const { data, isLoading, error, refetch, isFetching } = isErrors ? errorsResult : runsResult;
  const items = data?.[isErrors ? 'errors' : 'runs'] ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Source
          </label>
          <SourceSelect value={source} onChange={setSource} includeAll />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Limit
          </label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          >
            {[20, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={isFetching}
          onClick={() => refetch()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Error: {error.message}
        </div>
      )}

      {isErrors && !isLoading && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
          Only scraper failures and exceptions are shown here. Normal skips (not scheduled, dry run, no records) appear in Run History.
        </div>
      )}

      {!isLoading && (
        <DataTable
          columns={[
            { key: 'source', header: 'Source', render: (v) => <code className="text-xs">{v}</code> },
            { key: 'trigger', header: 'Trigger' },
            {
              key: 'status',
              header: 'Status',
              render: (v) => <StatusBadge value={v} />,
            },
            {
              key: 'dry_run',
              header: 'Dry run',
              render: (v) => (v ? <span className="text-blue-600">✓</span> : '—'),
            },
            { key: 'started_at', header: 'Started', render: (v) => fmtTime(v) },
            { key: 'completed_at', header: 'Completed', render: (v) => fmtTime(v) },
            { key: 'records_seen', header: 'Seen', render: (v) => v ?? '—' },
            { key: 'records_written', header: 'Written', render: (v) => v ?? '—' },
            {
              key: 'skip_reason',
              header: isErrors ? 'Error / skip' : 'Skip reason',
              render: (v, row) => {
                const msg = v || row.error || '—';
                return (
                  <span
                    className="block max-w-xs truncate text-xs text-slate-500"
                    title={msg}
                  >
                    {msg}
                  </span>
                );
              },
            },
          ]}
          rows={items.map((r, i) => ({ ...r, id: r.run_id || String(i) }))}
          empty={isErrors ? 'No scraper errors found.' : 'No runs recorded yet.'}
        />
      )}
    </div>
  );
}

// ── Readiness tab ─────────────────────────────────────────────────────────────

const READINESS_STYLES = {
  ready:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  watch:            'bg-amber-50  text-amber-700  border-amber-200',
  blocked:          'bg-rose-50   text-rose-700   border-rose-200',
  'needs-attention':'bg-amber-50  text-amber-700  border-amber-200',
  'manual-only':    'bg-slate-100 text-slate-500  border-slate-200',
  ready_to_promote: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const READINESS_ICON = {
  ready:            '✓',
  watch:            '⚠',
  blocked:          '✗',
  'needs-attention':'⚠',
  'manual-only':    '—',
  ready_to_promote: '✓',
};

function ReadinessBadge({ value }) {
  const cls = READINESS_STYLES[value] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  const icon = READINESS_ICON[value] ?? '?';
  const displayText = value === 'blocked' ? 'needs attention'
    : value === 'ready_to_promote' ? 'healthy'
    : value;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {icon} {displayText}
    </span>
  );
}

function DataHealthTab() {
  const [days, setDays] = useState(3);
  const { data, isLoading, error, refetch, isFetching } = useIngestionReadiness({ days });

  const global = data?.global ?? null;
  const sources = data?.sources ?? [];

  return (
    <div className="space-y-5">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Observation window
          </label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
          >
            {[1, 3, 7, 14].map((d) => (
              <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={isFetching}
          onClick={() => refetch()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-sm text-slate-500">Loading data health…</div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Failed to load data health: {error.message}
        </div>
      )}

      {/* Global status */}
      {global && (
        <div className={`rounded-xl border p-4 ${READINESS_STYLES[global.overall] ?? 'border-slate-200 bg-white'}`}>
          <div className={`flex flex-wrap items-center gap-3`}>
            <span className="text-sm font-semibold uppercase tracking-wide">Overall:</span>
            <ReadinessBadge value={global.overall === 'blocked' ? 'needs-attention' : global.overall} />
          </div>
          <p className="mt-2 text-sm">
            {global.overall === 'blocked'
              ? (() => {
                  // If any source has at least one successful run, this is "needs observation" not "no runs"
                  const anySuccess = (sources || []).some((s) => s.latest_success);
                  return anySuccess
                    ? `Needs more observation \u2014 a successful run was detected, but ${days} day${days !== 1 ? 's' : ''} of consistent runs are required before marking healthy.`
                    : 'No recent successful scraper runs found. Run bulk scrapers now or enable scheduled runs.';
                })()
              : global.recommendation}
          </p>
          {data?.evaluated_at && (
            <p className="mt-1 text-xs opacity-70">
              Evaluated {fmtTime(data.evaluated_at)} · last {days} day{days !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Per-source cards */}
      {sources.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {sources.map((s) => (
            <div
              key={s.source}
              className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
            >
              {/* Source header */}
              <div className="flex items-center justify-between gap-2">
                <code className="text-sm font-semibold text-slate-800">{s.source}</code>
                <ReadinessBadge value={s.readiness} />
              </div>

              {/* Metrics grid */}
              {s.total_runs != null && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span className="text-slate-400">Runs (window)</span>
                  <span>{s.total_runs}</span>

                  <span className="text-slate-400">Success rate</span>
                  <span>
                    {s.success_rate != null
                      ? `${(s.success_rate * 100).toFixed(1)}%`
                      : '—'}
                    {' '}
                    <span className="text-slate-400">
                      ({s.success_count}/{s.total_runs})
                    </span>
                  </span>

                  <span className="text-slate-400">Days observed</span>
                  <span>{s.days_observed}</span>

                  <span className="text-slate-400">Last success</span>
                  <span title={s.latest_success ?? '—'}>{fmtAge(s.latest_success)}</span>

                  <span className="text-slate-400">Last failure</span>
                  <span
                    className={s.latest_failure ? 'text-rose-600' : ''}
                    title={s.latest_failure ?? '—'}
                  >
                    {fmtAge(s.latest_failure)}
                  </span>

                  {s.avg_records_written != null && (
                    <>
                      <span className="text-slate-400">Avg written</span>
                      <span>
                        {s.avg_records_written}
                        <span className="text-slate-400 ml-1">
                          (min {s.min_records_written} / max {s.max_records_written})
                        </span>
                      </span>
                    </>
                  )}

                  {s.duplicate_key_warnings_total > 0 && (
                    <>
                      <span className="text-slate-400">Dup warnings</span>
                      <span className={s.duplicate_key_warnings_total >= 50 ? 'text-rose-600 font-semibold' : ''}>
                        {s.duplicate_key_warnings_total}
                      </span>
                    </>
                  )}

                  {s.required_field_missing_count_total > 0 && (
                    <>
                      <span className="text-slate-400">Missing fields</span>
                      <span className="text-amber-700">{s.required_field_missing_count_total}</span>
                    </>
                  )}
                </div>
              )}

              {/* Staleness */}
              {s.stale && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠ Data may be stale: {s.stale_reason}
                </div>
              )}                

              {/* Blockers */}
              {s.blockers?.length > 0 && (
                <div className="space-y-1">
                  {s.blockers.map((b, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700"
                    >
                      ✗ {b}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!isLoading && sources.length === 0 && !error && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
          No health data available. Ensure scheduled runs have been active for at least {days} day{days !== 1 ? 's' : ''}.
        </div>
      )}

      <p className="text-xs text-slate-400">
        Data health evaluates non-dry-run scheduled runs only. No production reads or writes are
        performed by this check. Promotion requires manual sign-off.
      </p>
    </div>
  );
}

// ── Admin status banner ───────────────────────────────────────────────

function AdminStatusBanner() {
  const { data, isLoading } = useIngestionReadiness({ days: 1 });
  if (isLoading || !data) return null;

  const overall = data?.global?.overall;
  const isHealthy = overall === 'ready_to_promote' || overall === 'ready';

  if (isHealthy) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
        <span>✅</span>
        <span>Data is up to date.</span>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
      <span>⚠</span>
      <span>No recent live (non-dry) scraper runs recorded — run bulk scrapers with dry run OFF to populate data health.</span>
    </div>
  );
}

// ── Panel root ────────────────────────────────────────────────────────────────

function ScraperOpsPanelInner() {
  const [tab, setTab] = useState('overview');

  return (
    <SectionCard
      title="Scraper Operations"
      subtitle="Monitor and control the v2 ingestion pipeline"
    >
      <AdminStatusBanner />

      {/* Tab bar */}
      <div className="mb-5 flex flex-wrap border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'run' && <ManualRunTab />}
      {tab === 'discovery' && (
        <div className="space-y-8">
          <FortBendDiscoveryTab />
          <HarrisSheriffSpnEnrichmentPanel />
        </div>
      )}
      {tab === 'scheduler' && <SchedulerTab onSaved={() => setTab('overview')} />}
      {tab === 'runs' && <RunsTab mode="runs" />}
      {tab === 'errors' && <RunsTab mode="errors" />}
      {tab === 'readiness' && <DataHealthTab />}
    </SectionCard>
  );
}

// ── Harris Sheriff SPN Enrichment panel ──────────────────────────────────────

function HarrisSheriffSpnEnrichmentPanel() {
  const [mode, setMode] = useState('batch'); // 'batch' | 'single'
  const [spn, setSpn] = useState('');
  const [limit, setLimit] = useState(25);
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [runPhase, setRunPhase] = useState(''); // human-readable step label
  const [elapsed, setElapsed] = useState(0);    // seconds since run start
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const elapsedRef = useRef(null);

  const triggerRun = useTriggerRun();

  function startElapsedTimer() {
    setElapsed(0);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }
  function stopElapsedTimer() {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
  }

  async function handleRun() {
    if (!dryRun && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    setResult(null);
    setRunning(true);
    startElapsedTimer();

    try {
      if (mode === 'single') {
        setRunPhase('Contacting Harris Sheriff JailInfo…');
        const data = await sendJSON('/admin/ingestion/enrich/harris-sheriff', {
          method: 'POST',
          body: { spn, dry_run: dryRun },
        });
        setResult(data);
      } else {
        setRunPhase('Querying recent Harris records — this may take up to 60 s…');
        const data = await triggerRun.mutateAsync({
          source: 'harris_sheriff_enrichment',
          dry_run: dryRun,
          limit,
          seed: 'recent_harris',
        });
        setResult(data);
      }
    } catch (err) {
      let msg = err.message;
      try { const b = JSON.parse(err.message.replace(/^Request failed \d+: /, '')); if (b?.message) msg = b.message; } catch { /* raw */ }
      setResult({ ok: false, message: msg });
    } finally {
      stopElapsedTimer();
      setRunning(false);
      setRunPhase('');
    }
  }

  const canRun = mode === 'batch' || (mode === 'single' && spn.trim().length >= 5);

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-purple-900">Harris Sheriff SPN Enrichment</h3>
        <p className="text-sm text-purple-700 mt-0.5">
          Query the Harris County Sheriff JailInfo site by SPN to verify custody status.
          If a person is confirmed <strong>NOT IN JAIL</strong>, their Harris records are
          automatically flagged as no longer a prospect (released or bailed).
          Only records from the <strong>past 7 days</strong> are eligible for batch enrichment.
        </p>
      </div>

      {/* Mode selector */}
      <div className="flex gap-2">
        {[['batch', 'Batch (recent Harris)'], ['single', 'Single SPN']].map(([m, label]) => (
          <button
            key={m}
            type="button"
            disabled={running}
            onClick={() => { setMode(m); setResult(null); setConfirming(false); }}
            className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors disabled:pointer-events-none disabled:opacity-50 ${
              mode === m
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {mode === 'single' && (
          <div>
            <label className="block text-xs font-medium text-purple-800 mb-1">
              SPN <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={spn}
              disabled={running}
              onChange={(e) => setSpn(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="e.g. 03334984"
              maxLength={8}
              className="w-full border border-purple-300 rounded px-3 py-1.5 text-sm focus:border-purple-500 focus:outline-none disabled:opacity-50"
            />
          </div>
        )}
        {mode === 'batch' && (
          <div>
            <label className="block text-xs font-medium text-purple-800 mb-1">Result Limit</label>
            <input
              type="number"
              min={1}
              max={50}
              disabled={running}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value))))}
              className="w-full border border-purple-300 rounded px-3 py-1.5 text-sm focus:border-purple-500 focus:outline-none disabled:opacity-50"
            />
          </div>
        )}
      </div>

      {/* Dry-run toggle */}
      <label className="flex cursor-pointer select-none items-center gap-2">
        <input
          type="checkbox"
          checked={dryRun}
          disabled={running}
          onChange={(e) => { setDryRun(e.target.checked); setConfirming(false); }}
          className="h-4 w-4 rounded border-purple-300 accent-purple-600 disabled:opacity-50"
        />
        <span className="text-sm text-purple-800">
          Dry run only — <span className="text-purple-500">no records written, no prospect flags set</span>
        </span>
      </label>

      {!dryRun && !running && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <strong>⚠ Warning:</strong> Dry run is OFF. &ldquo;Not in jail&rdquo; results will set{' '}
          <code className="text-xs">no_longer_prospect=true</code> on matching Harris records.
          {confirming && <span className="ml-1 font-medium"> Click <strong>Confirm</strong> to proceed.</span>}
        </div>
      )}

      {/* ── Running progress card ── */}
      {running && (
        <div className="rounded-xl border border-purple-300 bg-white px-4 py-4 space-y-3">
          <div className="flex items-center gap-3">
            {/* Animated spinner */}
            <svg className="h-5 w-5 shrink-0 animate-spin text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-purple-800">
                {mode === 'single'
                  ? `Running Sheriff SPN enrichment — ${spn}`
                  : `Running batch SPN enrichment — limit ${limit}`}
              </p>
              <p className="text-xs text-purple-600 mt-0.5">{runPhase}</p>
            </div>
            <span className="ml-auto text-xs tabular-nums text-slate-400">{elapsed}s</span>
          </div>
          {/* Indeterminate progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-purple-100">
            <div
              className="h-full rounded-full bg-purple-500"
              style={{ width: '40%', animation: 'indeterminate-progress 1.4s ease-in-out infinite' }}
            />
          </div>
          <style>{`
            @keyframes indeterminate-progress {
              0%   { transform: translateX(-200%); width: 40%; }
              100% { transform: translateX(350%);  width: 40%; }
            }
          `}</style>
          {mode === 'batch' && (
            <p className="text-xs text-slate-400 italic">
              Each SPN requires a live HTTP request to the Sheriff site — batch may take up to 60 seconds.
            </p>
          )}
        </div>
      )}

      {/* Run button row */}
      {!running && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={running || !canRun}
            onClick={handleRun}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              !canRun
                ? 'bg-purple-300 text-white cursor-not-allowed opacity-60'
                : confirming
                  ? 'border border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200'
                  : dryRun
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'border border-amber-500 bg-amber-600 text-white hover:bg-amber-700'
            }`}
          >
            {confirming
              ? '⚠ Confirm — write results'
              : mode === 'single'
                ? 'Run SPN Enrichment'
                : 'Run Batch Enrichment'}
          </button>
          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400"
            >
              Cancel
            </button>
          )}
          {mode === 'single' && !spn.trim() && (
            <span className="text-xs text-red-500">SPN is required</span>
          )}
        </div>
      )}

      {/* ── Result card ── */}
      {result && !running && (
        <div className={`rounded-xl border p-4 space-y-3 ${
          result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
        }`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base">{result.ok ? '✅' : '❌'}</span>
            <span className={`font-semibold text-sm ${result.ok ? 'text-emerald-800' : 'text-rose-800'}`}>
              {result.ok
                ? mode === 'single' ? 'Sheriff enrichment complete' : 'Batch enrichment complete'
                : mode === 'single' ? 'Sheriff enrichment failed' : 'Batch enrichment failed'}
            </span>
            {result.dry_run && (
              <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                dry-run
              </span>
            )}
            <span className="ml-auto text-xs text-slate-400 tabular-nums">{elapsed}s</span>
          </div>

          {/* Single-SPN result detail */}
          {mode === 'single' && result.ok && (
            <div className="space-y-2">
              {result.custody_status === 'not_in_custody' && (
                <div className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2.5 text-sm font-semibold text-amber-800">
                  ⚠ {result.full_name || `SPN ${result.spn}`} IS NOT IN JAIL
                  {!result.dry_run && (
                    <span className="ml-1 text-amber-700 font-normal">— Harris records flagged as no longer a prospect</span>
                  )}
                </div>
              )}
              {result.custody_status === 'in_custody' && (
                <div className="rounded-lg border border-blue-300 bg-blue-100 px-3 py-2.5 text-sm font-semibold text-blue-800">
                  🔒 {result.full_name || `SPN ${result.spn}`} IS IN CUSTODY
                </div>
              )}
              {(result.custody_status === 'no_match' || (!result.matched && result.custody_status == null)) && (
                <div className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-600">
                  No record found for SPN {result.spn}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                {[
                  ['SPN', result.spn],
                  ['Matched', result.matched ? 'Yes' : 'No'],
                  ['Written', result.dry_run ? '0 (dry-run)' : (result.written ?? 0)],
                  ['Date of birth', result.dob],
                  ['Age', result.age],
                  ['Sex', result.sex],
                  ['Race', result.race],
                ].filter(([, v]) => v != null).map(([k, v]) => (
                  <div key={k}><dt className="font-medium text-slate-500">{k}</dt><dd className="text-slate-800">{String(v ?? '—')}</dd></div>
                ))}
              </dl>
            </div>
          )}

          {/* Batch result stats */}
          {mode === 'batch' && result.ok && (
            <dl className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
              {[
                ['Seen', result.seen ?? result.records_seen],
                ['Matched', result.matched],
                ['Written', result.dry_run ? '0 (dry)' : (result.written ?? result.records_written ?? 0)],
                ['No match', result.unmatched],
                ['Errors', result.errors, result.errors > 0 ? 'text-rose-600' : ''],
                ['Skipped', result.skipped_cached, 'text-slate-500'],
              ].map(([k, v, cls = '']) => (
                <div key={k} className={cls}>
                  <dt className="text-xs font-medium text-slate-500">{k}</dt>
                  <dd className="text-base font-bold tabular-nums">{v ?? '—'}</dd>
                </div>
              ))}
            </dl>
          )}

          {result.message && (
            <p className={`text-xs ${result.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{result.message}</p>
          )}

          {result.stdout_tail && (
            <pre className="max-h-48 overflow-y-auto rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed text-emerald-300 whitespace-pre-wrap">
              {result.stdout_tail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScraperOpsPanel() {
  return (
    <ScraperOpsBoundary>
      <ScraperOpsPanelInner />
    </ScraperOpsBoundary>
  );
}
