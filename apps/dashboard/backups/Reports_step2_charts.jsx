import { useMemo, useState } from 'react';
import { PageHeader, SectionCard, SummaryStat } from '../components/PageToolkit';
import { useCaseStats, useCasesTimeline } from '../hooks/cases';
import { stageLabel } from '../lib/stage';

const toneForStage = (stage) => {
  switch (stage) {
    case 'accepted':
      return 'success';
    case 'denied':
      return 'danger';
    case 'qualifying':
      return 'info';
    default:
      return 'default';
  }
};

const formatCount = (value) => {
  if (value == null) return '—';
  const num = Number(value);
  return Number.isNaN(num) ? '—' : num.toLocaleString();
};

const percentage = (value, total) => {
  if (!total) return 0;
  return Math.round((value / total) * 100);
};

const TrendChart = ({ data }) => {
  const width = 320;
  const height = 120;
  const pad = 24;
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="h-24" />;
  }
  const counts = data.map((d) => d.count || 0);
  const bonds = data.map((d) => d.bondSum || 0);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  const minBond = Math.min(...bonds);
  const maxBond = Math.max(...bonds);
  const countRange = maxCount - minCount || 1;
  const bondRange = maxBond - minBond || 1;
  const step = (width - pad * 2) / Math.max(data.length - 1, 1);

  const linePoints = data
    .map((point, idx) => {
      const x = pad + idx * step;
      const y = height - pad - ((point.count - minCount) / countRange) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const areaPath = data
    .map((point, idx) => {
      const x = pad + idx * step;
      const y = height - pad - ((point.bondSum - minBond) / bondRange) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const areaPathWithBase = `${pad},${height - pad} ${areaPath} ${pad + (data.length - 1) * step},${height - pad}`;

  return (
    <svg width={width} height={height} className="block text-blue-500">
      <path d={areaPathWithBase} fill="rgba(59,130,246,0.1)" stroke="none" />
      <polyline points={linePoints} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
};

const SparklineLegend = ({ data }) => {
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  const last = data[data.length - 1];
  const delta = (last.count || 0) - (first.count || 0);
  const deltaBond = (last.bondSum || 0) - (first.bondSum || 0);
  return (
    <div className="flex flex-wrap items-center justify-between text-xs text-slate-600">
      <div>Start: {first.date}</div>
      <div>End: {last.date}</div>
      <div className={delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
        Δ bookings: {delta >= 0 ? '+' : ''}{delta}
      </div>
      <div className={deltaBond >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
        Δ bond: {deltaBond >= 0 ? '+' : ''}${Math.round(deltaBond).toLocaleString()}
      </div>
    </div>
  );
};

export default function Reports() {
  const { data, isLoading, isError, error, refetch } = useCaseStats({ staleTime: 120_000 });
  const [timelineDays, setTimelineDays] = useState(14);
  const {
    data: timelineData,
    isLoading: timelineLoading,
    isError: timelineError,
  } = useCasesTimeline({ queryKey: ['caseStats', 'timeline', timelineDays], staleTime: 60_000 });

  const stageEntries = useMemo(() => {
    if (!data?.stages) return [];
    const total = data.totals?.cases || 0;
    return Object.entries(data.stages)
      .map(([key, count]) => ({
        key,
        label: stageLabel(key),
        count: Number(count || 0),
        percent: percentage(Number(count || 0), total),
      }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  const followUps = data?.followUps || {};
  const assignments = data?.assignments || {};
  const attention = data?.attention || {};
  const checklist = data?.checklist || {};
  const totals = data?.totals || {};

  const timelineSeries = useMemo(() => {
    if (!timelineData?.rows) return [];
    const byDate = new Map();
    timelineData.rows.forEach((row) => {
      if (!row?.date) return;
      if (!byDate.has(row.date)) {
        byDate.set(row.date, { date: row.date, count: 0, bondSum: 0 });
      }
      const entry = byDate.get(row.date);
      entry.count += row.count || 0;
      entry.bondSum += row.bondSum || 0;
    });
    const sorted = Array.from(byDate.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
    return sorted.slice(-timelineDays);
  }, [timelineData, timelineDays]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Pipeline health, follow-ups, and attention at a glance."
        actions={(
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
            disabled={isLoading}
          >
            Refresh
          </button>
        )}
      />

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading reporting data…
        </div>
      ) : null}

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load reporting data: {error?.message || 'Unknown error'}
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryStat label="Total cases" value={formatCount(totals.cases)} hint={`Generated ${data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : ''}`} />
            <SummaryStat label="Assigned" value={formatCount(assignments.assigned)} tone="info" hint={`Unassigned: ${formatCount(assignments.unassigned)}`} />
            <SummaryStat label="Follow-ups overdue" value={formatCount(followUps.overdue)} tone="warn" hint={`Today: ${formatCount(followUps.dueToday)} • Upcoming: ${formatCount(followUps.upcoming)}`} />
            <SummaryStat label="Needs attention" value={formatCount(attention.needsAttention)} tone="danger" hint={`Refer to magistrate: ${formatCount(attention.referToMagistrate)}`} />
          </div>

          <SectionCard
            title="Timeline"
            subtitle="Booking counts aggregated across counties"
            action={(
              <div className="flex gap-2 text-xs">
                {[7, 14, 30].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setTimelineDays(days)}
                    className={`rounded-full border px-2 py-1 ${timelineDays === days ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:border-blue-300 hover:text-blue-700'}`}
                  >
                    Last {days}d
                  </button>
                ))}
              </div>
            )}
          >
            {timelineLoading ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
                Loading timeline…
              </div>
            ) : timelineError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                Timeline unavailable right now.
              </div>
            ) : timelineSeries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
                No recent bookings found for the selected window.
              </div>
            ) : (
              <div className="space-y-3">
                <TrendChart data={timelineSeries} />
                <SparklineLegend data={timelineSeries} />
              </div>
            )}
          </SectionCard>

          <SectionCard title="Stage distribution" subtitle="Case volume by CRM stage">
            {stageEntries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                No stage data available yet.
              </div>
            ) : (
              <ul className="space-y-3">
                {stageEntries.map((entry) => (
                  <li key={entry.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-800">{entry.label}</span>
                      <span className="text-xs text-slate-500">{formatCount(entry.count)} • {entry.percent}%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${toneForStage(entry.key) === 'success' ? 'bg-emerald-400' : toneForStage(entry.key) === 'danger' ? 'bg-rose-400' : toneForStage(entry.key) === 'info' ? 'bg-blue-400' : 'bg-slate-400'}`}
                        style={{ width: `${entry.percent}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Follow-up pipeline" subtitle="Coordinate outreach priorities">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overdue</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{formatCount(followUps.overdue)}</div>
                <p className="mt-2 text-sm text-slate-600">Cases needing immediate outreach.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due today</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{formatCount(followUps.dueToday)}</div>
                <p className="mt-2 text-sm text-slate-600">Scheduled follow-ups to complete by end of day.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Upcoming (7 days)</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{formatCount(followUps.upcoming)}</div>
                <p className="mt-2 text-sm text-slate-600">Prep for the week ahead to keep the pipeline moving.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unscheduled</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{formatCount(followUps.unscheduled)}</div>
                <p className="mt-2 text-sm text-slate-600">Cases without a next touch—consider prioritising these.</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Risk & requirements" subtitle="Spot cases needing extra attention">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing required docs</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{formatCount(checklist.casesMissingRequired)}</div>
                <p className="mt-2 text-sm text-slate-600">Cases blocked on missing paperwork.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Letter suffix cases</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{formatCount(attention.letterSuffix)}</div>
                <p className="mt-2 text-sm text-slate-600">Watch for warrants requiring manual review.</p>
              </div>
            </div>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
