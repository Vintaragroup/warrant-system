import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, SectionCard, SummaryStat, DataTable } from '../components/PageToolkit';
import { useCases } from '../hooks/cases';
import { getJSON } from '../hooks/dashboard';
import { useUser } from '../components/UserContext';
import ScraperOpsPanel from './ScraperOpsPanel';
import TelnyxStatusPanel from './TelnyxStatusPanel';

export default function Admin() {
  const navigate = useNavigate();
  const { currentUser } = useUser();

  // ── Health check ─────────────────────────────────────────────────────────
  const [healthState, setHealthState] = useState(null); // null | 'loading' | { ok, ts, pid?, error? }

  const runHealthCheck = useCallback(async () => {
    setHealthState('loading');
    try {
      const data = await getJSON('/health/light');
      setHealthState({ ok: data.ok ?? true, ts: data.ts ?? new Date().toISOString(), pid: data.pid });
    } catch (err) {
      let msg = err.message ?? 'Unknown error';
      try {
        const body = JSON.parse(msg.replace(/^Request failed \d+: /, ''));
        if (body?.error) msg = body.error;
      } catch { /* use raw message */ }
      setHealthState({ ok: false, ts: new Date().toISOString(), error: msg });
    }
  }, []);

  // Pull a small recent sample to surface data freshness
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const start = new Date(today);
  start.setDate(start.getDate() - 7);
  const startDate = start.toISOString().slice(0, 10);
  const { data: recentCases } = useCases({ startDate, endDate, limit: 25, sortBy: 'booking_date', order: 'desc', noCount: true });
  const sampleRows = useMemo(() => {
    const items = Array.isArray(recentCases?.items) ? recentCases.items : [];
    return items.map((item) => {
      const ing = item.normalized_at || item.scraped_at || item.updatedAt || item.createdAt || null;
      const booked = item.booking_date || null;
      const toAge = (v) => {
        if (!v) return '—';
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        const hours = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        return hours < 24 ? `${hours}h` : `${days}d ${hours % 24}h`;
      };
      return {
        id: String(item._id || item.id || item.case_number || Math.random()),
        name: item.full_name || 'Unknown',
        county: (item.county || '').charAt(0).toUpperCase() + (item.county || '').slice(1),
        booked: booked || '—',
        bookingAge: toAge(booked),
        ingestedAt: ing ? new Date(ing).toLocaleString() : '—',
        dataAge: toAge(ing),
      };
    });
  }, [recentCases]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin"
        subtitle="Monitor scrapers, integrations, and manage user access."
        actions={(
          <div className="flex gap-2">
            <button
              type="button"
              disabled={healthState === 'loading'}
              onClick={runHealthCheck}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300 disabled:opacity-60"
            >
              {healthState === 'loading' ? 'Checking…' : 'Run health check'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/auth/admin-users')}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400"
            >
              Invite user
            </button>
          </div>
        )}
      />

      {/* Health check result */}
      {healthState && healthState !== 'loading' && (
        <div
          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            healthState.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <span>
            {healthState.ok ? '✓ API is healthy' : `✗ API reported an issue: ${healthState.error ?? 'unknown'}`}
          </span>
          <span className="text-xs opacity-70">
            {healthState.ts ? new Date(healthState.ts).toLocaleTimeString() : ''}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <SummaryStat label="Scheduled jobs" value={6} />
        <div className="sm:col-span-3">
          <SummaryStat
            label="Sources"
            value="Bulk: Galveston, Harris, Wharton  ·  Lookup: Fort Bend, Jefferson, Brazoria"
            hint="See Scraper Ops for live status"
            tone="default"
          />
        </div>
      </div>

      <ScraperOpsPanel />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TelnyxStatusPanel />

        <SectionCard title="Users & roles" subtitle="Access control">
          <p className="py-2 text-sm text-slate-500">
            User management coming soon.
          </p>
          {currentUser && (
            <p className="mt-1 text-xs text-slate-400">
              Signed in as <strong>{currentUser.email}</strong> &mdash; role:{' '}
              <strong>{(currentUser.roles ?? []).join(', ') || 'none'}</strong>
            </p>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Data freshness" subtitle="Compare ingestion time vs booking time (last 25 bookings)">
        <DataTable
          columns={[
            { key: 'name', header: 'Name' },
            { key: 'county', header: 'County' },
            { key: 'booked', header: 'Booked (date)' },
            { key: 'bookingAge', header: 'Booking age' },
            { key: 'ingestedAt', header: 'Ingested at' },
            { key: 'dataAge', header: 'Data age' },
          ]}
          rows={sampleRows}
          empty="No recent cases in the last week."
        />
      </SectionCard>
    </div>
  );
}
