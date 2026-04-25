import { useMemo } from 'react';
import { PageHeader, SectionCard, SummaryStat } from '../components/PageToolkit';
import { useProspectReport } from '../hooks/prospectReports';

const formatCount = (value) => {
  if (value == null) return '—';
  const num = Number(value);
  return Number.isNaN(num) ? '—' : num.toLocaleString();
};

export default function Reports() {
  const { data, isLoading, isError, error, refetch } = useProspectReport({ staleTime: 60_000 });

  const stats = useMemo(() => ({
    totalProspects: data?.totalProspects7d ?? null,
    enriched: data?.enrichedCount ?? null,
    texted: data?.textedCount ?? null,
    responded: data?.respondedCount ?? null,
  }), [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Prospect funnel over the last 7 days."
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
            <SummaryStat label="Prospects (7d)" value={formatCount(stats.totalProspects)} hint="New prospects created in last 7 days" />
            <SummaryStat label="Enriched" value={formatCount(stats.enriched)} tone="info" hint="Prospects enriched by automation" />
            <SummaryStat label="Texted" value={formatCount(stats.texted)} tone="default" hint="Prospects sent enrichment texts" />
            <SummaryStat label="Responded" value={formatCount(stats.responded)} tone="success" hint="Replies across text/email/call automation" />
          </div>
          <SectionCard title="Prospect automation" subtitle="Enrichment and outreach touchpoints for the last 7 days.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryStat label="Enriched" value={formatCount(stats.enriched)} tone="info" hint="Prospects enriched" />
              <SummaryStat label="Texted" value={formatCount(stats.texted)} tone="default" hint="Automation texts sent" />
              <SummaryStat label="Responded" value={formatCount(stats.responded)} tone="success" hint="Replies to text/email/call" />
              <SummaryStat label="Prospects (7d)" value={formatCount(stats.totalProspects)} tone="default" hint="Total created in window" />
            </div>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
