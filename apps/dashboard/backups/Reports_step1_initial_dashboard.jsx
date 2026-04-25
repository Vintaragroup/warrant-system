import { useMemo } from 'react';
import { PageHeader, SectionCard, SummaryStat } from '../components/PageToolkit';
import { useCaseStats } from '../hooks/cases';
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

export default function Reports() {
  const { data, isLoading, isError, error, refetch } = useCaseStats({ staleTime: 120_000 });

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
