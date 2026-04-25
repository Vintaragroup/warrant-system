import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, SummaryStat, PageToolbar, FilterPills, DataTable, SectionCard } from '../components/PageToolkit';
import { useProspects } from '../hooks/prospects';
import { useEnrichmentProxyHealth } from '../hooks/enrichment';
import { API_BASE, getAuthHeader } from '../lib/api';

const COUNTIES = ['all', 'harris', 'brazoria', 'galveston', 'fortbend', 'jefferson'];
const WINDOW_OPTIONS = [
  { id: '24h', label: 'Last 24h' },
  { id: '48h', label: 'Last 48h' },
  { id: '72h', label: 'Last 72h' },
];

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

export default function Prospects() {
  const navigate = useNavigate();
  const { data: health } = useEnrichmentProxyHealth({
    // lazy fetch once the page mounts
    refetchOnWindowFocus: false,
  });
  const [county, setCounty] = useState('all');
  const [windowId, setWindowId] = useState('72h');
  const [minBond, setMinBond] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);

  const windowHours = windowId === '72h' ? 72 : windowId === '48h' ? 48 : 24;
  const { data, isLoading, isError, error, refetch, isFetching } = useProspects({
    windowHours,
    minBond: minBond != null && minBond !== '' ? Number(minBond) : undefined,
    limit: 200,
    county: county !== 'all' ? county : undefined,
    attention: attentionOnly,
  });

  const rows = useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((item, idx) => {
      // Support both dashboard case shape and enrichment prospect shape
      const id = String(
        item._id
        || item.id
        || item.case_number
        || item.booking_number
        || item.subjectId
        || `${item.full_name || item.name || 'case'}-${idx}`
      );
      const contactPhoneValue = item.crm_details?.phone
        || item.phone
        || item.primary_phone
        || item.phone_nbr1
        || item.phone_nbr2
        || item.phone_nbr3
        || '';
      const name = item.full_name || item.name || (item.subjectId ? `Subject ${item.subjectId}` : 'Unknown');
      const countyValueRaw = (item.county || '').replace(/^./, (c) => c.toUpperCase());
      const bookingDate = item.booking_date || item.bookingDate || '—';
      const bondAmount = item.bond_amount ?? item.bond;
      const spn = item.spn || item.booking_number || item.subjectId || '—';
      const needsAttention = Boolean(item.needs_attention ?? item.moreChargesPossible);
      const addressCounty = (() => {
        const base = item.baseAddressSnippet || item.address || '';
        const selectedCounty = county !== 'all' ? county.charAt(0).toUpperCase() + county.slice(1) : '';
        const countyValue = countyValueRaw || selectedCounty;
        const joined = [base, countyValue].filter(Boolean).join(' · ');
        return joined || countyValue || base || '—';
      })();
      const status = (() => {
        if (item.notBondableStrict || item.notBondable) return 'Not bondable';
        if (item.moreChargesPossible) return 'Review charges';
        if (item.dob) return 'DOB found';
        if (bookingDate && !Number.isNaN(new Date(bookingDate).getTime())) return 'Pending DOB';
        return 'Not started';
      })();
      return {
        key: id,
        caseId: String(item._id || item.id || item.case_number || item.subjectId || id),
        caseNumber: item.case_number || item.booking_number || item.subjectId,
        name,
        county: addressCounty,
        bookingDate,
        bondAmount,
        spn,
        dob: item.dob || null,
        contacted: Boolean(item.contacted),
        contactPhone: contactPhoneValue,
        status,
        needsAttention,
      };
    }, [data, county]);
  }, [data, county]);

  const activeFilters = [
    county !== 'all' ? `County: ${county}` : null,
    windowId ? `Window: ${WINDOW_OPTIONS.find((w) => w.id === windowId)?.label}` : null,
    minBond != null && minBond !== '' ? `Min bond: $${Number(minBond).toLocaleString()}` : null,
    attentionOnly ? 'Needs attention' : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prospects"
        subtitle="Recent bookings filtered for likely opportunities."
        actions={(
          <div className="flex items-center gap-2">
            <span
              title={health?.target ? `Enrichment: ${health.target}` : 'Enrichment proxy status'}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${health?.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${health?.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              {health?.ok ? 'Connected' : 'Unreachable'}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
            >
              Refresh
            </button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <SummaryStat label="Results (page)" value={rows.length} hint={isFetching ? 'Refreshing…' : undefined} />
  <SummaryStat label="Attention (page)" value={rows.filter((r) => r.needsAttention).length} tone="warn" />
  <SummaryStat label="Contacted (page)" value={rows.filter((r) => r.contacted).length} tone="info" />
  <SummaryStat label="Avg. bond (page)" value={formatMoney(rows.length ? Math.round(rows.reduce((s, r) => s + (Number(r.bondAmount) || 0), 0) / rows.length) : 0)} tone="success" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterPills items={activeFilters} onClear={activeFilters.length ? () => {
          setCounty('all');
          setWindowId('72h');
          setMinBond('');
          setAttentionOnly(false);
        } : undefined} />
      </div>

      <PageToolbar>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-col text-sm">
            <span className="text-slate-500">County</span>
            <select
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {COUNTIES.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-slate-500">Window</span>
            <select
              value={windowId}
              onChange={(e) => setWindowId(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {WINDOW_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-slate-500">Min bond</span>
            <input
              type="number"
              value={minBond}
              onChange={(e) => setMinBond(e.target.value)}
              placeholder="$0"
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
        </div>
        <div className="flex flex-col gap-3 sm:w-[200px] sm:flex-none">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={attentionOnly}
              onChange={(e) => setAttentionOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Needs attention
          </label>
        </div>
      </PageToolbar>

  <SectionCard title="Results" subtitle={isFetching ? 'Refreshing…' : `${rows.length} prospect${rows.length === 1 ? '' : 's'}`}>
        {isError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Failed to load prospects: {error?.message || 'Unknown error'}
          </div>
        ) : isLoading ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Loading prospects…
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'name', header: 'Person' },
              { key: 'county', header: 'County' },
              { key: 'bookingDate', header: 'Booked' },
              { key: 'dob', header: 'DOB', render: (value) => {
                if (!value) return '—';
                const v = String(value);
                if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return v;
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                  const [y, m, d] = v.split('-');
                  return `${Number(m)}/${Number(d)}/${y}`;
                }
                return v;
              } },
              { key: 'bondAmount', header: 'Bond', render: (v) => formatMoney(v) },
              { key: 'spn', header: 'SPN' },
              { key: 'contactPhone', header: 'Phone', render: (_v, row) => {
                // Show enrichment step/status in the Phone column per requirements
                if (row.status) {
                  const tone = row.status === 'Not bondable' ? 'bg-rose-50 text-rose-700' : row.status === 'Review charges' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';
                  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${tone}`}>{row.status}</span>;
                }
                return _v ? formatPhone(_v) : '—';
              } },
              { key: 'contacted', header: 'Contacted', render: (value) => (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${value ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {value ? 'Yes' : 'No'}
                </span>
              )},
            ]}
            rows={rows}
            empty="No prospects match these filters. Try widening the window (72h), unchecking 'Needs attention', or lowering the minimum bond."
            onRowClick={(row) => {
              // Row contains case_number from prospects data; use it to look up the actual MongoDB _id
              if (row.caseNumber) {
                // Use case_number to look up the actual MongoDB ID
                (async () => {
                  try {
                    const auth = await getAuthHeader();
                    const url = `${API_BASE}/cases/by-case-number/${encodeURIComponent(row.caseNumber)}`;
                    const r = await fetch(url, { headers: auth ? { ...auth } : {} });
                    if (!r.ok) throw new Error('Case not found');
                    const doc = await r.json();
                    navigate(`/cases/${doc._id}`);
                  } catch (err) {
                    console.error('Failed to resolve case:', err);
                    alert(`Could not find case for ${row.name}`);
                  }
                })();
              } else if (row.caseId) {
                navigate(`/cases/${row.caseId}`);
              } else {
                alert(`No case ID available for ${row.name}`);
              }
            }}
          />
        )}
      </SectionCard>
    </div>
  );
}
