import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, SectionCard, SummaryStat } from '../components/PageToolkit';
import { useCase } from '../hooks/cases';

const formatMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `$${num.toLocaleString()}`;
};

export default function CaseDetail() {
  const navigate = useNavigate();
  const { caseId } = useParams();
  const { data, isLoading, isError, error, refetch } = useCase(caseId);


  const manualTags = useMemo(() => (
    Array.isArray(data?.manual_tags) ? Array.from(new Set(data.manual_tags)).sort() : []
  ), [data]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Loading case…" />
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Loading case details…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Unable to load case" />
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load case: {error?.message || 'Unknown error'}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Case not found" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Case not found.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.full_name || 'Case detail'}
        subtitle={data.case_number ? `Case #${data.case_number}` : 'Full record overview'}
        actions={(
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400"
            >
              Back
            </button>
          </div>
        )}
      />

      <SectionCard title="Case snapshot" subtitle="Key information about this client">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryStat label="Stage" value={data.crm_stage || 'new'} />
          <SummaryStat label="Bond" value={formatMoney(data.bond_amount)} />
          <SummaryStat label="County" value={data.county || '—'} />
          <SummaryStat label="Status" value={data.status || '—'} />
        </div>
      </SectionCard>

      <SectionCard title="Tags" subtitle="Manual tags assigned to this case">
        <div className="flex flex-wrap gap-2">
          {manualTags.length === 0 ? <span className="text-slate-500">None</span> : null}
          {manualTags.map((tag) => (
            <span key={tag} className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              {tag.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Meta" subtitle="Reference details">
        <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Case number</dt>
            <dd>{data.case_number || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Booking number</dt>
            <dd>{data.booking_number || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Agency</dt>
            <dd>{data.agency || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Facility</dt>
            <dd>{data.facility || '—'}</dd>
          </div>
        </dl>
      </SectionCard>
    </div>
  );
}

function DetailItem({ label, value, children }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children ? children : <div className="mt-1 text-sm text-slate-800">{value}</div>}
    </div>
  );
}
