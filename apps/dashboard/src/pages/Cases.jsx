import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader, SummaryStat, PageToolbar, FilterPills, DataTable, SectionCard } from '../components/PageToolkit';
import CrmStageSelect from '../components/CrmStageSelect';
import { stageLabel } from '../lib/stage';
import CaseActionsPopover from '../components/CaseActionsPopover';
import { useCases, useCaseMeta, useCaseStats } from '../hooks/cases';

const COUNTIES = ['all', 'harris', 'brazoria', 'galveston', 'fortbend', 'jefferson'];
const STATUSES = ['All', 'Active', 'Needs Review', 'Closed'];
const RESULT_LIMIT = 25;
const WINDOW_OPTIONS = [
  { id: 'all', label: 'All time' },
  { id: '24h', label: 'Last 24h' },
  { id: '48-72h', label: '48–72h' },
  { id: '48h', label: 'Last 48h' },
  { id: '72h', label: 'Last 72h' },
];

const SORT_OPTIONS = [
  { id: 'booking_date:desc', label: 'Newest first', sortBy: 'booking_date', order: 'desc' },
  { id: 'booking_date:asc', label: 'Oldest first', sortBy: 'booking_date', order: 'asc' },
  { id: 'bond_amount:desc', label: 'Highest bond first', sortBy: 'bond_amount', order: 'desc' },
  { id: 'bond_amount:asc', label: 'Lowest bond first', sortBy: 'bond_amount', order: 'asc' },
];

const CONTACT_OPTIONS = [
  { id: 'all', label: 'Any contact' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'not_contacted', label: 'Not contacted' },
];

const ATTENTION_OPTIONS = [
  { id: 'all', label: 'Any attention reason' },
  { id: 'refer_to_magistrate', label: 'Refer to magistrate' },
  { id: 'letter_suffix_case', label: 'Letter suffix case' },
];

const DEFAULT_STAGES = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualifying', label: 'Qualifying' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'denied', label: 'Denied' },
];

const DEFAULT_CASE_WINDOW_DAYS = 60;

const prettyCounty = (value = '') => {
  const v = String(value).toLowerCase();
  if (!v) return '—';
  return v.charAt(0).toUpperCase() + v.slice(1);
};

const formatMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `$${num.toLocaleString()}`;
};

const formatShortAddress = (address) => {
  if (!address || typeof address !== 'object') return '';
  const line1 = address.streetLine1 || address.line1 || '';
  const city = address.city || '';
  const state = address.stateCode || address.state || '';
  const postal = address.postalCode || address.zip || '';
  const parts = [line1, [city, state].filter(Boolean).join(', '), postal].filter((part) => part && part.trim().length > 0);
  return parts.join(' • ');
};

const formatPhone = (value) => {
  if (!value) return '';
  const v = String(value);
  const digits = v.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return v;
};

const formatDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const daysAgo = (sourceDate, days) => {
  const d = new Date(sourceDate);
  d.setDate(d.getDate() - days);
  return d;
};

function computeWindowRange(windowId) {
  // For rolling windows (24h/48h/72h) let the server compute by booking time via ?window; return empty.
  if (windowId === 'all' || windowId === '24h' || windowId === '48h' || windowId === '72h') return {};

  // Handle "recent" 48–72h window from dashboard deep-links
  if (windowId === '48-72h' || windowId === '48–72h' || windowId === 'recent') {
    const now = Date.now();
    const start = new Date(now - 72 * 60 * 60 * 1000); // 72h ago (inclusive)
    const end = new Date(now - 48 * 60 * 60 * 1000);   // 48h ago (exclusive upper bound)
    // We send inclusive YYYY-MM-DD to the server which compares string dates on booking_date
    // This approximates [72h, 48h) by full-day boundaries in local TZ.
    return { startDate: formatDate(start), endDate: formatDate(end) };
  }

  // Default: clamp to the last N days
  const today = new Date();
  const endDate = formatDate(today);
  const startDate = formatDate(daysAgo(today, DEFAULT_CASE_WINDOW_DAYS));
  return { startDate, endDate };
}

export default function Cases() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: meta } = useCaseMeta();
  const { data: statsData } = useCaseStats();
  const [search, setSearch] = useState('');
  const [county, setCounty] = useState('all');
  const [status, setStatus] = useState('All');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [windowId, setWindowId] = useState('all');
  const [sortKey, setSortKey] = useState('booking_date:desc');
  const [minBond, setMinBond] = useState('');
  const [contactStatus, setContactStatus] = useState('all');
  const [attentionType, setAttentionType] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const effectiveRange = useMemo(() => {
    const today = new Date();
    const windowRange = computeWindowRange(windowId);
    const baseStart = formatDate(daysAgo(today, DEFAULT_CASE_WINDOW_DAYS));
    const computedStart = windowRange.startDate || baseStart;
    const startDate = computedStart > baseStart ? computedStart : baseStart;
    const endDate = windowRange.endDate || formatDate(today);
    return { startDate, endDate };
  }, [windowId]);

  // Initialize filters from URL query params (e.g., /cases?county=harris&window=24h or 48-72h)
  useEffect(() => {
    try {
      const sp = new URLSearchParams(location.search || '');
      const qpCounty = sp.get('county');
      const qpWindowRaw = sp.get('window');

      if (qpCounty && COUNTIES.includes(qpCounty)) {
        setCounty(qpCounty);
      }

      if (qpWindowRaw) {
        const w = qpWindowRaw.toLowerCase();
        if (w === '24h' || w === '48h' || w === '72h') {
          setWindowId(w);
        } else if (w === '48-72h' || w === '48–72h' || w === 'recent') {
          // Support dashboard "recent" deep-links
          setWindowId('48-72h');
        }
      }
    } catch {
      // ignore malformed URLs
    }
    // Run on location.search change
  }, [location.search]);

  const filters = useMemo(() => ({
    query: search.trim() || undefined,
    county: county !== 'all' ? county : undefined,
    status: status !== 'All' ? status : undefined,
    attention: attentionOnly,
    limit: RESULT_LIMIT,
    sortBy: SORT_OPTIONS.find((opt) => opt.id === sortKey)?.sortBy ?? 'booking_date',
    order: SORT_OPTIONS.find((opt) => opt.id === sortKey)?.order ?? 'desc',
    minBond: minBond !== '' ? Number(minBond) : undefined,
    contacted: contactStatus === 'contacted' ? 'true' : contactStatus === 'not_contacted' ? 'false' : undefined,
    attentionType: attentionType !== 'all' ? attentionType : undefined,
    stage: stageFilter !== 'all' ? stageFilter : undefined,
    startDate: effectiveRange.startDate,
    endDate: effectiveRange.endDate,
    // Only pass recognized rolling windows to the server; compute others (like 48-72h) via start/end
    window: (windowId === '24h' || windowId === '48h' || windowId === '72h') ? windowId : undefined,
  }), [
    search,
    county,
    status,
    attentionOnly,
    sortKey,
    minBond,
    contactStatus,
    attentionType,
    stageFilter,
    effectiveRange.startDate,
    effectiveRange.endDate,
    windowId,
  ]);

  const { data, isLoading, isError, error, refetch, isFetching } = useCases(filters);

  const caseItems = data?.items;
  const items = useMemo(() => (Array.isArray(caseItems) ? caseItems : []), [caseItems]);
  const totalCount = data?.count ?? items.length;
  const totalRecords = data?.total ?? totalCount;

  const stats = useMemo(() => {
    const active = items.filter((item) => (item.status || '').toLowerCase() === 'active').length;
    const needsAttention = items.filter((item) => item.needs_attention).length;
    const avgBond = items.length
      ? Math.round(items.reduce((sum, item) => sum + (Number(item.bond_amount) || 0), 0) / items.length)
      : 0;
    return {
      total: totalRecords,
      active,
      needsAttention,
      avgBond,
    };
  }, [items, totalRecords]);

  const pipelineStats = useMemo(() => {
    const totals = statsData?.totals || {};
    const followUps = statsData?.followUps || {};
    const assignments = statsData?.assignments || {};
    const attention = statsData?.attention || {};
    const checklist = statsData?.checklist || {};
    return {
      totalCases: totals.cases ?? null,
      assigned: assignments.assigned ?? null,
      unassigned: assignments.unassigned ?? null,
      followOverdue: followUps.overdue ?? null,
      followDueToday: followUps.dueToday ?? null,
      followUpcoming: followUps.upcoming ?? null,
      needsAttention: attention.needsAttention ?? null,
      referToMagistrate: attention.referToMagistrate ?? null,
      missingRequired: checklist.casesMissingRequired ?? null,
    };
  }, [statsData]);

  const formatCount = (value) => {
    if (value == null) return '—';
    const num = Number(value);
    if (Number.isNaN(num)) return '—';
    return num.toLocaleString();
  };

  const stageOptions = useMemo(() => {
    if (Array.isArray(meta?.stages) && meta.stages.length) {
      return meta.stages.map((id) => ({
        id,
        label: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      }));
    }
    return DEFAULT_STAGES;
  }, [meta]);

  const stageOptionIds = useMemo(() => stageOptions.map((opt) => opt.id), [stageOptions]);

  const rows = useMemo(() => (
    items.map((item, index) => {
      const fallbackId = item._id || item.id || item.case_number || item.booking_number || `${item.full_name || 'case'}-${item.booking_date || index}`;
      const id = String(fallbackId);
      const attentionReasons = Array.isArray(item.attention_reasons) ? item.attention_reasons : [];
      const manualTags = Array.isArray(item.manual_tags) ? Array.from(new Set(item.manual_tags)).sort() : [];
      const sourceTags = Array.isArray(item.tags) ? item.tags : [];
      const systemFlags = attentionReasons.length ? attentionReasons : item.needs_attention ? ['needs_attention'] : [];
      const flags = Array.from(new Set([...sourceTags, ...systemFlags])).sort();
      const caseId = String(item._id || item.id || item.case_number || id);
      const assignedOwner = item.crm_details?.assignedTo || '';
      const followUpIso = item.crm_details?.followUpAt || null;
      const contactAddressShort = formatShortAddress(item.crm_details?.address || item.address || {});
      const contactPhoneValue =
        item.crm_details?.phone
        || item.phone
        || item.primary_phone
        || item.phone_nbr1
        || item.phone_nbr2
        || item.phone_nbr3
        || '';
      const ageMs = (() => {
        const ref = item.booking_date;
        if (!ref) return null;
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(ref) ? `${ref}T00:00:00Z` : ref;
        const d = new Date(iso);
        return !Number.isNaN(d.getTime()) ? (Date.now() - d.getTime()) : null;
      })();
      const ageHours = ageMs != null ? Math.floor(ageMs / (1000 * 60 * 60)) : null;
      const ageDays = ageHours != null ? Math.floor(ageHours / 24) : null;
      return {
        key: id,
        caseId,
        id: item.case_number || id,
        name: item.full_name || 'Unknown',
        county: prettyCounty(item.county),
        bookingDate: item.booking_date || '—',
        dob: item.dob || null,
        bondAmount: item.bond_amount,
        status: item.status || '—',
  spn: item.spn || item.booking_number || '—',
        manualTags,
      flags,
      stage: item.crm_stage || 'new',
      needsAttention: Boolean(item.needs_attention),
        contacted: Boolean(item.contacted),
        lastContact: item.last_contact_at ? new Date(item.last_contact_at).toLocaleString() : '—',
        assignedTo: assignedOwner,
        followUpAt: followUpIso,
        contactPhone: contactPhoneValue,
        contactAddress: contactAddressShort,
        ageLabel: (ageHours != null)
          ? (ageHours < 24 ? `${ageHours}h` : `${ageDays}d ${ageHours % 24}h`)
          : '—',
        raw: item,
      };
    })
  ), [items]);

  const activeFilters = [
    `Case age: ≤${DEFAULT_CASE_WINDOW_DAYS}d`,
    county !== 'all' ? `County: ${county}` : null,
    status !== 'All' ? `Status: ${status}` : null,
    attentionOnly ? 'Needs attention' : null,
    windowId !== 'all' ? `Window: ${WINDOW_OPTIONS.find((opt) => opt.id === windowId)?.label}` : null,
    sortKey !== 'booking_date:desc' ? `Sort: ${SORT_OPTIONS.find((opt) => opt.id === sortKey)?.label}` : null,
    minBond !== '' ? `Min bond: $${Number(minBond).toLocaleString()}` : null,
    contactStatus !== 'all' ? `Contact: ${CONTACT_OPTIONS.find((opt) => opt.id === contactStatus)?.label}` : null,
    attentionType !== 'all' ? `Attention: ${ATTENTION_OPTIONS.find((opt) => opt.id === attentionType)?.label}` : null,
    stageFilter !== 'all' ? `Stage: ${stageOptions.find((opt) => opt.id === stageFilter)?.label}` : null,
  ].filter(Boolean);

  useEffect(() => {
    if (activeFilters.length && !filtersOpen) {
      setFiltersOpen(true);
    }
  }, [activeFilters.length, filtersOpen]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cases"
        subtitle={`Showing bookings from the last ${DEFAULT_CASE_WINDOW_DAYS} days by default.`}
        actions={(
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
          >
            Refresh
          </button>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat
          label={`Cases (≤${DEFAULT_CASE_WINDOW_DAYS}d)`}
          value={formatCount(totalRecords)}
          tone="info"
          hint={`Range ${effectiveRange.startDate} – ${effectiveRange.endDate}`}
        />
        <SummaryStat
          label="Unassigned"
          value={formatCount(pipelineStats.unassigned)}
          tone="info"
          hint={pipelineStats.assigned != null ? `Assigned: ${formatCount(pipelineStats.assigned)}` : undefined}
        />
        <SummaryStat
          label="Follow-ups overdue"
          value={formatCount(pipelineStats.followOverdue)}
          tone="warn"
          hint={(() => {
            const parts = [];
            if (pipelineStats.followDueToday != null) parts.push(`Today: ${formatCount(pipelineStats.followDueToday)}`);
            if (pipelineStats.followUpcoming != null) parts.push(`Upcoming: ${formatCount(pipelineStats.followUpcoming)}`);
            if (pipelineStats.missingRequired != null) parts.push(`Missing docs: ${formatCount(pipelineStats.missingRequired)}`);
            return parts.length ? parts.join(' • ') : undefined;
          })()}
        />
        <SummaryStat
          label="Needs attention"
          value={formatCount(pipelineStats.needsAttention)}
          tone="danger"
          hint={pipelineStats.referToMagistrate != null
            ? `Refer to magistrate: ${formatCount(pipelineStats.referToMagistrate)}`
            : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat label="Results (page)" value={items.length} hint={`of ${formatCount(totalRecords)}`} />
        <SummaryStat label="Active (page)" value={stats.active} tone="info" hint="Based on current result set" />
        <SummaryStat label="Needs attention (page)" value={stats.needsAttention} tone="warn" />
        <SummaryStat label="Avg. bond (page)" value={formatMoney(stats.avgBond)} tone="success" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterPills
          items={activeFilters}
          onClear={activeFilters.length ? () => {
            setCounty('all');
            setStatus('All');
            setAttentionOnly(false);
            setWindowId('all');
            setSortKey('booking_date:desc');
            setMinBond('');
            setContactStatus('all');
            setAttentionType('all');
            setStageFilter('all');
          } : undefined}
        />
        <button
          type="button"
          onClick={() => setFiltersOpen((prev) => !prev)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-blue-300 hover:text-blue-700"
        >
          {filtersOpen ? 'Hide filters' : 'Show filters'}
        </button>
      </div>

      {filtersOpen ? (
        <PageToolbar>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex flex-col text-sm">
              <span className="text-slate-500">Search</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, case #, charge…"
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </label>
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
              <span className="text-slate-500">Sort</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {SORT_OPTIONS.map((opt) => (
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
            <label className="flex flex-col text-sm">
              <span className="text-slate-500">Contacted</span>
              <select
                value={contactStatus}
                onChange={(e) => setContactStatus(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {CONTACT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-slate-500">Attention type</span>
              <select
                value={attentionType}
                onChange={(e) => setAttentionType(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {ATTENTION_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-slate-500">Stage</span>
              <CrmStageSelect
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                stageOptions={stageOptionIds}
                includeAny
                anyLabel="Any stage"
                anyValue="all"
                variant="filter"
              />
            </label>
          </div>
        </PageToolbar>
      ) : null}


      <SectionCard
        title="Results"
        subtitle={isFetching ? 'Refreshing…' : `${totalCount} total result${totalCount === 1 ? '' : 's'}`}
      >
        {isError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Failed to load cases: {error?.message || 'Unknown error'}
          </div>
        ) : (
          <>
            {isLoading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                Loading cases…
              </div>
            ) : (
              <DataTable
                columns={[
                  { key: 'name', header: 'Person' },
                  { key: 'id', header: 'Case ID' },
                  { key: 'county', header: 'County' },
                  { key: 'bookingDate', header: 'Booked' },
                  {
                    key: 'dob',
                    header: 'DOB',
                    render: (value) => {
                      if (!value) return '—';
                      const v = String(value);
                      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return v;
                      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                        const [y, m, d] = v.split('-');
                        return `${Number(m)}/${Number(d)}/${y}`;
                      }
                      return v;
                    },
                  },
                  { key: 'ageLabel', header: 'Age' },
                  {
                    key: 'bondAmount',
                    header: 'Bond',
                    render: (value) => formatMoney(value),
                  },
                  { key: 'spn', header: 'SPN' },
                  {
                    key: 'stage',
                    header: 'Stage',
                    render: (value) => (
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                        {stageLabel(value)}
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (value) => (
                      <span className="inline-flex rounded-full border border-slate-300 px-2 py-0.5 text-xs">
                        {value}
                      </span>
                    ),
                  },
                  {
                    key: 'contactPhone',
                    header: 'Phone',
                    render: (value) => (value ? formatPhone(value) : '—'),
                  },
                  {
                    key: 'contactAddress',
                    header: 'Address',
                    render: (value) => value || '—',
                  },
                  {
                    key: 'contacted',
                    header: 'Contacted',
                    render: (value) => (
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                          value
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {value ? 'Yes' : 'No'}
                      </span>
                    ),
                  },
                  {
                    key: 'lastContact',
                    header: 'Last Contact',
                  },
                ]}
                rows={rows}
                empty="No cases match these filters yet."
                onRowClick={(row) => navigate(`/cases/${row.caseId}`)}
                renderActions={(row) => (
                  <CaseActionsPopover
                    caseId={row.caseId}
                    stage={row.stage}
                    manualTags={row.manualTags}
                    contactInfo={{ contacted: row.contacted, last: row.raw.last_contact_at }}
                    assignedTo={row.assignedTo}
                    followUpAt={row.followUpAt}
                    onRefresh={() => {
                      refetch();
                      queryClient.invalidateQueries({ queryKey: ['case', row.caseId] });
                      queryClient.invalidateQueries({ queryKey: ['caseActivity', row.caseId] });
                    }}
                    onOpenCase={() => navigate(`/cases/${row.caseId}`)}
                  />
                )}
              />
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
