import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, SectionCard } from '../components/PageToolkit';
import { useCase } from '../hooks/cases';
import { stageLabel } from '../lib/stage';

const formatMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return `$${num.toLocaleString()}`;
};

const formatRelative = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'checklist', label: 'Checklist' },
];

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
  const bondDisplay = (() => {
    const numeric = formatMoney(data?.bond_amount);
    if (numeric) return numeric;
    if (data?.bond_status) return data.bond_status.replace(/_/g, ' ');
    if (data?.bond_label) return data.bond_label;
    if (data?.bond) return String(data.bond);
    return '—';
  })();

  const [activeTab, setActiveTab] = useState('overview');

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

  const renderChecklistList = () => {
    if (!totalChecklist) {
      return (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No onboarding tasks have been configured for this case yet.
        </div>
      );
    }

    return (
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
    );
  };

  const StatTile = ({ label, value, hint }) => (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );

  const overviewContent = (
    <div className="space-y-6">
      <SectionCard title="Case snapshot" subtitle="Latest onboarding status">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatTile label="Stage" value={stageDisplay} />
          <StatTile label="Bond" value={bondDisplay} />
          <StatTile label="Assigned" value={data.crm_details?.assignedTo || 'Unassigned'} />
          <StatTile label="Next follow-up" value={followUpDisplay} />
          <StatTile
            label="Checklist"
            value={totalChecklist ? `${completedChecklist}/${totalChecklist}` : '—'}
            hint={totalChecklist ? `${checklistProgress}% complete` : undefined}
          />
          <StatTile
            label="Last contact"
            value={lastContactDisplay}
            hint={data.contacted ? 'Contacted' : 'No outreach yet'}
          />
        </div>
      </SectionCard>

      <SectionCard title="Case summary" subtitle="Reference details for this client file">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <DetailItem label="Case number" value={data.case_number || '—'} />
            <DetailItem label="Booking number" value={data.booking_number || '—'} />
            <DetailItem label="County" value={data.county || '—'} />
            <DetailItem label="Category" value={data.category || '—'} />
            <DetailItem label="Agency" value={data.agency || '—'} />
            <DetailItem label="Facility" value={data.facility || '—'} />
            <DetailItem label="Status" value={data.status || '—'} />
          </div>
          <div className="space-y-3">
            <DetailItem label="Primary charge" value={data.charge || data.offense || '—'} />
            <DetailItem label="Manual tags">
              <div className="mt-1 flex flex-wrap gap-2">
                {manualTags.length === 0 ? <span className="text-slate-500">None</span> : null}
                {manualTags.map((tag) => (
                  <span key={`manual-${tag}`} className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                    {tag.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </DetailItem>
            <DetailItem label="Source" value={data.source || '—'} />
            <DetailItem label="Updated" value={formatRelative(data.updatedAt || data.normalized_at)} />
          </div>
        </div>
      </SectionCard>
    </div>
  );

  const checklistContent = (
    <SectionCard
      title="Onboarding checklist"
      subtitle={totalChecklist
        ? `${completedChecklist}/${totalChecklist} items • ${requiredChecklist ? `${requiredCompleted}/${requiredChecklist} required` : 'No required items'} • ${checklistProgress}% complete`
        : 'No checklist items configured yet'}
    >
      {renderChecklistList()}
    </SectionCard>
  );

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

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? overviewContent : checklistContent}
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
