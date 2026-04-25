import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, SectionCard, SummaryStat } from '../components/PageToolkit';
import { useCase } from '../hooks/cases';
import { stageLabel } from '../lib/stage';

const formatMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `$${num.toLocaleString()}`;
};

const formatRelative = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

export default function CaseDetail() {
  const navigate = useNavigate();
  const { caseId } = useParams();
  const { data, isLoading, isError, error, refetch } = useCase(caseId);


  const manualTags = useMemo(
    () => (Array.isArray(data?.manual_tags) ? Array.from(new Set(data.manual_tags)).sort() : []),
    [data]
  );

  const checklistItems = useMemo(
    () => (Array.isArray(data?.crm_details?.documents) ? data.crm_details.documents : []),
    [data?.crm_details?.documents]
  );

  const totalChecklist = checklistItems.length;
  const completedChecklist = checklistItems.filter((item) => item?.status === 'completed').length;
  const requiredChecklist = checklistItems.filter((item) => item?.required).length;
  const requiredCompleted = checklistItems.filter((item) => item?.required && item?.status === 'completed').length;
  const checklistProgress = totalChecklist ? Math.round((completedChecklist / totalChecklist) * 100) : 0;

  const stageDisplay = stageLabel(data?.crm_stage || 'new');
  const followUpDisplay = formatRelative(data?.crm_details?.followUpAt);
  const lastContactDisplay = formatRelative(data?.last_contact_at);

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

      <SectionCard title="Case snapshot" subtitle="Latest onboarding status">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <SummaryStat label="Stage" value={stageDisplay} />
          <SummaryStat label="Bond" value={formatMoney(data.bond_amount)} />
          <SummaryStat label="Assigned" value={data.crm_details?.assignedTo || 'Unassigned'} />
          <SummaryStat label="Next follow-up" value={followUpDisplay} />
          <SummaryStat
            label="Checklist"
            value={totalChecklist ? `${completedChecklist}/${totalChecklist}` : '—'}
            hint={totalChecklist ? `${checklistProgress}% complete` : 'No items yet'}
          />
          <SummaryStat
            label="Last contact"
            value={lastContactDisplay}
            tone={data.contacted ? 'success' : 'default'}
            hint={data.contacted ? 'Contacted' : 'No outreach yet'}
          />
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

      <SectionCard
        title="Onboarding checklist"
        subtitle={totalChecklist
          ? `${completedChecklist}/${totalChecklist} items • ${requiredChecklist ? `${requiredCompleted}/${requiredChecklist} required` : 'No required items'} • ${checklistProgress}% complete`
          : 'No checklist items configured yet'}
      >
        {totalChecklist ? (
          <ul className="space-y-2">
            {checklistItems.map((item) => {
              const key = item?.key || item?.label || 'checklist-item';
              const label = item?.label || item?.key || 'Checklist item';
              const isRequired = Boolean(item?.required);
              const isCompleted = item?.status === 'completed';
              return (
                <li
                  key={key}
                  className={`flex items-start justify-between rounded-lg border px-3 py-2 text-sm ${
                    isCompleted ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div>
                    <div className="font-medium text-slate-800">{label}</div>
                    <div className="text-xs text-slate-500">
                      {isRequired ? 'Required' : 'Optional'}
                      {isCompleted && item?.completedAt ? ` • Completed ${formatRelative(item.completedAt)}` : ''}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isCompleted ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {isCompleted ? 'Done' : 'Pending'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        No onboarding tasks have been configured for this case yet.
      </div>
    )}
  </SectionCard>
    </div>
  );
}
