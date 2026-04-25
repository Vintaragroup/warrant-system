import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, SummaryStat, PageToolbar, FilterPills, DataTable, SectionCard } from '../components/PageToolkit';
import { useCases, useCaseMeta } from '../hooks/cases';

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `$${num.toLocaleString()}`;
}

function formatPhone(value) {
  if (!value) return '';
  const v = String(value);
  const digits = v.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return v;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

export default function CRM() {
  const navigate = useNavigate();
  const [stageFilter, setStageFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');

  const { data: casesData, isLoading: casesLoading, isError: casesError } = useCases({
    limit: 100,
    sortBy: 'booking_date',
    order: 'desc',
  });

  const { data: metaData } = useCaseMeta();

  const cases = useMemo(() => casesData?.cases || [], [casesData]);
  const stageOptions = useMemo(() => metaData?.stages || [], [metaData]);

  // Filter cases based on stage and assignment
  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const stageMatch = stageFilter === 'all' || c.crm_details?.stage === stageFilter;
      const assignMatch = assignedFilter === 'all' || (assignedFilter === 'unassigned' ? !c.crm_details?.assignedTo : c.crm_details?.assignedTo === assignedFilter);
      return stageMatch && assignMatch;
    });
  }, [cases, stageFilter, assignedFilter]);

  // Calculate stage summary stats
  const stageCounts = useMemo(() => {
    const counts = {};
    stageOptions.forEach((opt) => {
      counts[opt.id] = cases.filter((c) => c.crm_details?.stage === opt.id).length;
    });
    return counts;
  }, [cases, stageOptions]);

  const unassignedCount = useMemo(
    () => cases.filter((c) => !c.crm_details?.assignedTo).length,
    [cases]
  );

  const followUpDueCount = useMemo(() => {
    const now = new Date();
    return cases.filter((c) => {
      const followUp = c.crm_details?.followUpAt;
      if (!followUp) return false;
      const followUpDate = new Date(followUp);
      return followUpDate <= now;
    }).length;
  }, [cases]);

  const columns = [
    {
      header: 'Case #',
      accessor: 'case_number',
      cell: (row) => (
        <button
          onClick={() => navigate(`/cases/${row._id}`)}
          className="text-blue-600 hover:underline font-medium"
        >
          {row.case_number || '—'}
        </button>
      ),
    },
    {
      header: 'Defendant',
      accessor: 'defendant_name',
      cell: (row) => row.defendant_name || '—',
    },
    {
      header: 'Stage',
      accessor: (row) => row.crm_details?.stage || 'unassigned',
      cell: (row) => {
        const stage = row.crm_details?.stage;
        const stageLabel = stageOptions.find((s) => s.id === stage)?.label || stage || 'Unassigned';
        return (
          <span className="inline-block rounded-full px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800">
            {stageLabel}
          </span>
        );
      },
    },
    {
      header: 'Assigned To',
      accessor: (row) => row.crm_details?.assignedTo || '—',
    },
    {
      header: 'Bond Amount',
      accessor: (row) => row.bond_amount,
      cell: (row) => formatMoney(row.bond_amount),
    },
    {
      header: 'Phone',
      accessor: (row) => row.crm_details?.phone || row.phone_nbr1 || '—',
      cell: (row) => {
        const phone = row.crm_details?.phone || row.phone_nbr1;
        return formatPhone(phone);
      },
    },
    {
      header: 'Follow Up',
      accessor: (row) => row.crm_details?.followUpAt,
      cell: (row) => {
        const followUp = row.crm_details?.followUpAt;
        if (!followUp) return '—';
        const isOverdue = new Date(followUp) <= new Date();
        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
            {formatDate(followUp)}
          </span>
        );
      },
    },
  ];

  if (casesError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load CRM data
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM"
        subtitle="Manage client relationships and case workflows"
      />

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat
          label="Total Cases"
          value={cases.length}
          tone="default"
        />
        <SummaryStat
          label="Unassigned"
          value={unassignedCount}
          tone="warn"
        />
        <SummaryStat
          label="Follow-up Due"
          value={followUpDueCount}
          tone="danger"
        />
        <SummaryStat
          label="Active Stages"
          value={Object.values(stageCounts).filter((count) => count > 0).length}
          tone="info"
        />
      </div>

      {/* Filter Bar */}
      <PageToolbar>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="text-xs font-semibold uppercase text-slate-500">Stage</label>
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All Stages</option>
                {stageOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} ({stageCounts[opt.id] || 0})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase text-slate-500">Assigned</label>
              <select
                value={assignedFilter}
                onChange={(e) => setAssignedFilter(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="unassigned">Unassigned ({unassignedCount})</option>
              </select>
            </div>
          </div>

          <div className="text-sm text-slate-600">
            Showing {filteredCases.length} of {cases.length} cases
          </div>
        </div>
      </PageToolbar>

      {/* Cases Table */}
      <SectionCard title="Cases" subtitle={`CRM workflow and client management (${filteredCases.length} total)`}>
        {casesLoading ? (
          <div className="text-center py-8 text-slate-500">Loading cases...</div>
        ) : filteredCases.length === 0 ? (
          <div className="text-center py-8 text-slate-500">No cases match the selected filters.</div>
        ) : (
          <DataTable columns={columns} data={filteredCases} />
        )}
      </SectionCard>

      {/* Stage Breakdown */}
      <SectionCard title="Stage Breakdown" subtitle="Cases by workflow stage">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {stageOptions.map((stage) => (
            <button
              key={stage.id}
              onClick={() => setStageFilter(stage.id)}
              className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-blue-300 hover:bg-blue-50 transition-colors"
            >
              <div className="font-medium text-slate-900">{stage.label}</div>
              <div className="mt-1 text-2xl font-semibold text-blue-600">{stageCounts[stage.id] || 0}</div>
              <div className="mt-1 text-xs text-slate-500">
                {((stageCounts[stage.id] || 0) / Math.max(cases.length, 1) * 100).toFixed(0)}% of total
              </div>
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
