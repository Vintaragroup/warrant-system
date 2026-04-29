import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  useKpis,
  useTopByValue,
  usePerCounty,
  useCountyTrends,
  useNewToday,
  useRecent48to72,
  useRecent,
  useChargeBonds,
} from '../hooks/dashboard';
import { legacyWindowForBucket, bucketClasses } from '../lib/buckets';
import { useCaseStats, useCases } from '../hooks/cases';
import DashboardDebugPanel from './DashboardDebugPanel.jsx';
import { API_BASE, getAuthHeader } from '../lib/api';
import { getJSON } from '../hooks/dashboard';

// Always render these 5
const ALL_COUNTIES = ['brazoria', 'fortbend', 'galveston', 'harris', 'jefferson'];

const COUNTY_LABELS = {
  brazoria: 'Brazoria',
  fortbend: 'Fort Bend',
  galveston: 'Galveston',
  harris: 'Harris',
  jefferson: 'Jefferson',
};

const prettyCounty = (name) =>
  COUNTY_LABELS[name] || (name ? name.charAt(0).toUpperCase() + name.slice(1) : '');

const formatLabel = (text = '') =>
  text
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const safeDateLabel = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
};

const isStalePull = (value) => {
  if (!value || value === '—') return true;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  return ageHours >= STALE_PULL_THRESHOLD_HOURS;
};

const offenseText = (item = {}) => {
  if (item.offense) return item.offense;
  if (item.charge) return item.charge;
  if (Array.isArray(item.charges) && item.charges.length) {
    const first = item.charges[0];
    if (typeof first === 'string') return first;
    if (first?.description) return first.description;
    if (first?.offense) return first.offense;
    if (first?.charge) return first.charge;
  }
  return '';
};

const agencyText = (item = {}) =>
  item.agency || item.facility || item.agency_name || item.jail_name || '';

const toCaseId = (item = {}) => {
  const candidate =
    item.id ??
    item.case_id ??
    item.caseId ??
    item._id ??
    item.case_number ??
    item.booking_number ??
    item.bookingNumber ??
    null;
  return candidate != null ? String(candidate) : null;
};

const shapeSnapshotRow = (item, source, extras = {}) => {
  const caseId = toCaseId(item);
  const rawBooked =
    item.booking_date || item.bookedAt || item.booked_at || item.normalized_at || null;
  const booked = rawBooked instanceof Date ? rawBooked.toISOString().slice(0, 10) : rawBooked || '';
  const timeBucketV2 = item.time_bucket_v2 || item.time_bucket || null;
  const mappedWindow = item.mapped_window || (timeBucketV2 ? legacyWindowForBucket(timeBucketV2) : null);
  return {
    caseId,
    key: caseId || `${source}-${item.person || item.name || item.full_name || Math.random()}`,
    name: item.name || item.person || item.full_name || 'Unknown',
    county: prettyCounty(item.county),
    booked,
    bookingDateTime: item.booking_datetime || null,
    timeBucketV2,
    mappedWindow,
    bondAmount: item.bond_amount ?? item.value ?? null,
    bondStatus: item.bond_status || (Number(item.bond_amount ?? item.value) ? 'numeric' : null),
    bondRaw: item.bond_raw || item.bond || item.bond_label || null,
    offense: offenseText(item),
    agency: agencyText(item),
    contacted: Boolean(item.contacted),
    lastContact: item.last_contact_at || item.last_contact || null,
    sex: item.sex || item.gender || null,
    race: item.race || null,
    category:
      source === 'top'
        ? item.category || null
        : item.crm_stage || item.stage || item.status || null,
    needsAttention: Boolean(item.needs_attention),
    attentionReasons: Array.isArray(item.attention_reasons) ? item.attention_reasons : [],
    source,
    timeBucket: item.time_bucket || null,
    scrapedAt: item.scraped_at || item.scrapedAt || null,
    normalizedAt: item.normalized_at || item.normalizedAt || null,
    ...extras,
  };
};

const SNAPSHOT_TABS = [
  { id: 'top', label: 'Top value' },
  { id: 'new', label: 'New 24h' },
  { id: 'recent', label: '48–72h' },
  { id: 'attention', label: 'Needs attention' },
];

const SNAPSHOT_CONTACT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'uncontacted', label: 'Uncontacted' },
  { id: 'contacted', label: 'Contacted' },
];

const SNAPSHOT_EMPTY_COPY = {
  top: 'No results for this window.',
  new: 'No bookings in this window.',
  recent: 'No results in the 48–72h window.',
  attention: 'No cases currently need manual attention.',
};

const COUNTY_SORT_OPTIONS = [
  { id: 'bond', label: 'Sort by bond' },
  { id: 'volume', label: 'Sort by volume' },
];

const STALE_PULL_THRESHOLD_HOURS = 12;

// Debug flag: toggle in console with window.__DASH_DEBUG__ = true
if (typeof window !== 'undefined' && window.__DASH_DEBUG__ == null) {
  window.__DASH_DEBUG__ = false;
}

// Money formatting helper
const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toLocaleString()}` : '$0';
};

// County key normalization helper
const normCountyKey = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/county/g, '')
    .replace(/[^a-z]/g, '');

// Render a bond amount or a status badge when the value is non-numeric.
function BondDisplay({ amount, status, raw }) {
  const v = Number(amount ?? 0);
  const isNumeric = Number.isFinite(v) && v > 0;

  if (status === 'numeric' || isNumeric) {
    return <div className="font-semibold">{money(v)}</div>;
  }

  // Map status -> label and tone
  const map = {
    refer_to_magistrate: { label: 'Refer to Magistrate', tone: 'warn' },
    summons: { label: 'Summons', tone: 'default' },
    unsecured: { label: 'Unsecured', tone: 'danger' },
    no_bond: { label: 'No bond', tone: 'default' },
    unknown_text: { label: 'Note', tone: 'default' },
  };

  const entry = map[status] || { label: String(status || 'Unknown'), tone: 'default' };

  const toneClasses = {
    default: 'bg-slate-100 text-slate-700',
    success: 'bg-green-50 text-green-700',
    warn: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
  };

  return (
    <div>
      <span
        title={String(raw || '')}
        className={`inline-flex items-center rounded-md text-[11px] px-2 py-1 ${toneClasses[entry.tone]}`}
      >
        {entry.label}
      </span>
    </div>
  );
}

function MiniStackedBar({ new24, new48, new72, new3to7 }) {
  const total = Math.max((new24 || 0) + (new48 || 0) + (new72 || 0) + (new3to7 || 0), 0.0001);
  const p24    = ((new24    || 0) / total) * 100;
  const p48    = ((new48    || 0) / total) * 100;
  const p72    = ((new72    || 0) / total) * 100;
  const p3to7  = ((new3to7  || 0) / total) * 100;
  return (
    <div className="w-full">
      <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full bg-green-400 inline-block" style={{ width: `${p24}%` }} />
        <div className="h-full bg-amber-400 inline-block" style={{ width: `${p48}%` }} />
        <div className="h-full bg-red-400 inline-block" style={{ width: `${p72}%` }} />
        <div className="h-full bg-purple-400 inline-block" style={{ width: `${p3to7}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>24h: {new24 || 0}</span>
        <span>48h: {new48 || 0}</span>
        <span>72h: {new72 || 0}</span>
        <span>3-7d: {new3to7 || 0}</span>
      </div>
    </div>
  );
}

function Sparkline({ values = [] }) {
  const width = 160, height = 36, pad = 2;
  if (!values.length) return <div className="h-9" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="block">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-blue-500"
      />
    </svg>
  );
}

function KpiCard({ label, value, sublabel, tone = 'default', to, right }) {
  const base = 'rounded-2xl border shadow-sm p-4 bg-white';
  const tones = {
    default: '',
    success: 'ring-1 ring-green-100',
    warn: 'ring-1 ring-amber-100',
    danger: 'ring-1 ring-red-100',
  };
  const ValueBlock = (
    <div className="mt-1 flex items-baseline gap-2">
      <div className="text-xl font-bold text-slate-800 sm:text-2xl">{value}</div>
      {sublabel ? <div className="text-xs text-slate-500">{sublabel}</div> : null}
    </div>
  );
  return (
    <div className={`${base} ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500">{label}</div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {to ? <Link to={to} className="block">{ValueBlock}</Link> : ValueBlock}
    </div>
  );
}

// Root component (search for existing default export further below). We'll inject DebugPanel near top-level container.

function Panel({ title, subtitle, children, className = '', to, right }) {
  return (
    <section className={`bg-white rounded-2xl border shadow-sm p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          {right}
          {to ? (
            <Link to={to} className="text-sm text-blue-600 hover:text-blue-700">
              View all
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function WindowSwitcher({ value, onChange }) {
  const btn =
    'px-2 py-1 text-xs rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700';
  return (
    <div className="inline-flex gap-1">
      {['24h', '48h', '72h'].map((w) => (
        <button
          key={w}
          className={btn}
          data-active={value === w}
          onClick={() => onChange(w)}
          type="button"
        >
          {w}
        </button>
      ))}
    </div>
  );
}

export default function DashboardScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Debug toggle (persisted). Enable by adding ?debug=1 to the URL or clicking the header button.
  const [debug, setDebug] = useState(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('debug') === '1') return true;
      return localStorage.getItem('dashDebug') === '1';
    } catch {
      // ignore storage access
      return false;
    }
  });
  const toggleDebug = useCallback(() => {
    setDebug((prev) => {
      const next = !prev;
      try { localStorage.setItem('dashDebug', next ? '1' : '0'); } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);
  // Debug minimize toggle (persisted)
  const [debugMin, setDebugMin] = useState(() => {
    try { return localStorage.getItem('dashDebugMin') === '1'; } catch {
      // ignore storage access
      return false;
    }
  });
  const toggleDebugMin = useCallback(() => {
    setDebugMin((prev) => {
      const next = !prev;
      try { localStorage.setItem('dashDebugMin', next ? '1' : '0'); } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);
  // Window used for Top10 and Bond Value panel
  const [valueWindow, setValueWindow] = useState('24h');
  const [chargeWindow, setChargeWindow] = useState('7d');
  const [chargeCounty, setChargeCounty] = useState('all');
  const [showAllCharges, setShowAllCharges] = useState(false);
  const [expandedCharge, setExpandedCharge] = useState(null);
  const forceRefresh = useCallback(() => {
    try {
      // Invalidate and refetch all dashboard-related queries
      const keys = [
        ['kpis'],
        ['perCounty', valueWindow],
        ['topByValue', valueWindow, 10],
        ['countyTrends', 7],
        ['newToday', 'all'],
        ['recent48to72', 10],
        ['caseStats'],
        // cases attention snapshot
        ['cases'],
      ];
      keys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      keys.forEach((key) => queryClient.refetchQueries({ queryKey: key }));
    } catch {
      // ignore refetch errors
    }
  }, [queryClient, valueWindow]);

  // ── Queries
  const { data: kpiData, isLoading: _kpisLoading } = useKpis();
  const { data: top10, isLoading: _topLoading } = useTopByValue(valueWindow, 10);
  const { data: perCounty, isLoading: _perCountyLoading } = usePerCounty(valueWindow);
  const { data: chargeBondsData } = useChargeBonds({ window: chargeWindow, county: chargeCounty, limit: 20 });
  const { data: countyTrends, isLoading: _trendsLoading } = useCountyTrends(7);
  const { data: new24h, isLoading: _new24Loading } = useNewToday('all');
  // Recent window toggle (default 48–72h); options: '48-72h' | '3-7d'
  const [recentWindow, setRecentWindow] = useState('48-72h');
  // KPI card toggle for the "New (48–72h)" card
  const [kpiRecentWindow, setKpiRecentWindow] = useState('48-72h');
  const { data: recent48to72, isLoading: _recentLoadingLegacy } = useRecent48to72(10);
  const { data: recentSelectable, isLoading: _recentLoadingNew } = useRecent(recentWindow, 10);
  const recentData = recentSelectable || recent48to72;
  const recentLoading = (_recentLoadingLegacy && !recentSelectable) || _recentLoadingNew;
  const { data: caseStats } = useCaseStats({ staleTime: 120_000 });
  const [snapshotTab, setSnapshotTab] = useState('top');
  const [snapshotFilters, setSnapshotFilters] = useState({
    top: 'all',
    new: 'all',
    recent: 'all',
    attention: 'all',
  });
  const setSnapshotFilter = (tab, value) =>
    setSnapshotFilters((prev) => ({
      ...prev,
      [tab]: value,
    }));
  const [countySort, setCountySort] = useState('bond');
  const [countyAttentionOnly, setCountyAttentionOnly] = useState(false);

  // ── Normalize
  const perCountyItems = useMemo(
    () => (Array.isArray(perCounty?.items) ? perCounty.items : []),
    [perCounty]
  );
  const perCountyWindowUsed = perCounty?.windowUsed || valueWindow;
  const perCountyMap = useMemo(() => {
    const m = new Map();
    perCountyItems.forEach((c) => {
      m.set(normCountyKey(c.county), c);
    });
    return m;
  }, [perCountyItems]);

  // Determine if debug panel should render (explicit toggle or global flag)
  const showDebugPanel = debug || (typeof window !== 'undefined' && window.__DASH_DEBUG__);

  // top endpoint may return either array or enriched object { items, mode }
  const topPayload = useMemo(() => {
    if (!top10) return { items: [], mode: null };
    if (Array.isArray(top10)) return { items: top10, mode: null };
    if (Array.isArray(top10.items)) return { items: top10.items, mode: top10.mode || null };
    return { items: [], mode: null };
  }, [top10]);
  const top10Raw = topPayload.items;
  const apiMode = topPayload.mode || null; // 'v2_buckets' when flag enabled (from server enrichment)
  const topWindowUsed = top10Raw.length ? (top10Raw[0].window_used || valueWindow) : valueWindow;
  const topFallbackNotice = top10Raw.length > 0 && topWindowUsed !== valueWindow;
  const applyContactFilter = (list = [], filter = 'all') => {
    const arr = Array.isArray(list) ? list : [];
    if (filter === 'contacted') return arr.filter((item) => item.contacted);
    if (filter === 'uncontacted') return arr.filter((item) => !item.contacted);
    return arr;
  };
  const top10List = useMemo(
    () => applyContactFilter(top10Raw, snapshotFilters.top),
    [top10Raw, snapshotFilters.top]
  );
  // Toggle to prioritize items with phone numbers and recency in Top tab
  const [prioritizePhone, setPrioritizePhone] = useState(false);
  const [contactMeta, setContactMeta] = useState({}); // id -> { hasPhone, recencyTs }

  // Enrich Top list with phone presence when toggled on
  useEffect(() => {
    if (!prioritizePhone || snapshotTab !== 'top') return;
    const ids = (top10Raw || []).map((it) => String(it?.id || '')).filter(Boolean);
    const missing = ids.filter((id) => contactMeta[id] == null);
    if (!missing.length) return;
    let alive = true;
    (async () => {
      try {
        const results = await Promise.all(
          missing.map(async (id) => {
            try {
              const detail = await getJSON(`/cases/${encodeURIComponent(id)}`);
              const phones = [
                detail?.crm_details?.phone,
                detail?.phone,
                detail?.primary_phone,
                detail?.phone_nbr1,
                detail?.phone_nbr2,
                detail?.phone_nbr3,
              ];
              const hasPhone = phones.some((p) => p && String(p).replace(/\D/g, '').length >= 10);
              const tsRaw = detail?.updatedAt || detail?.normalized_at || detail?.scraped_at || detail?.booking_date || null;
              const recencyTs = tsRaw ? (Date.parse(tsRaw) || 0) : 0;
              return [id, { hasPhone, recencyTs }];
            } catch {
              return [id, { hasPhone: false, recencyTs: 0 }];
            }
          })
        );
        if (!alive) return;
        setContactMeta((prev) => {
          const next = { ...prev };
          results.forEach(([id, meta]) => { next[id] = meta; });
          return next;
        });
      } catch {
        // ignore
      }
    })();
    return () => { alive = false; };
  }, [prioritizePhone, snapshotTab, top10Raw, contactMeta]);

  // Reset accordion and "show all" when charge filters change
  useEffect(() => {
    setExpandedCharge(null);
    setShowAllCharges(false);
  }, [chargeWindow, chargeCounty]);

  const top10Prioritized = useMemo(() => {
    if (!prioritizePhone || snapshotTab !== 'top') return top10List;
    const arr = (top10List || []).slice();
    // Only change ordering if at least one item actually has a phone on file;
    // otherwise keep original order to avoid confusing resorting on recency alone.
    const anyHasPhone = arr.some((it) => {
      const id = it?.id != null ? String(it.id) : null;
      return id && contactMeta[id]?.hasPhone;
    });
    if (!anyHasPhone) return arr;
    const tsOf = (it) => Date.parse(it?.normalized_at || it?.scraped_at || it?.booking_date || '') || 0;
    const bondOf = (it) => Number(it?.bond_amount ?? it?.value ?? 0) || 0;
    arr.sort((a, b) => {
      const ma = contactMeta[a?.id] || { hasPhone: false, recencyTs: tsOf(a) };
      const mb = contactMeta[b?.id] || { hasPhone: false, recencyTs: tsOf(b) };
      if (ma.hasPhone !== mb.hasPhone) return ma.hasPhone ? -1 : 1;
      if (ma.recencyTs !== mb.recencyTs) return mb.recencyTs - ma.recencyTs;
      return bondOf(b) - bondOf(a);
    });
    return arr;
  }, [prioritizePhone, snapshotTab, top10List, contactMeta]);

  // Count how many of the current Top items have a phone on file
  const topHasPhoneCount = useMemo(() => {
    const list = Array.isArray(top10Raw) ? top10Raw : [];
    let n = 0;
    for (const it of list) {
      const id = it?.id != null ? String(it.id) : null;
      if (id && contactMeta[id]?.hasPhone) n += 1;
    }
    return n;
  }, [top10Raw, contactMeta]);
  const top10Counts = useMemo(() => {
    const contacted = top10Raw.filter((item) => item.contacted).length;
    return {
      total: top10Raw.length,
      contacted,
      uncontacted: top10Raw.length - contacted,
    };
  }, [top10Raw]);
  const attentionSummary = useMemo(() => {
    if (!caseStats) return null;
    const total = Number(caseStats?.totals?.cases || 0);
    const needs = Number(caseStats?.attention?.needsAttention || 0);
    const refer = Number(caseStats?.attention?.referToMagistrate || 0);
    const letter = Number(caseStats?.attention?.letterSuffix || 0);
    const missingDocs = Number(caseStats?.checklist?.casesMissingRequired || 0);
    return { total, needs, refer, letter, missingDocs };
  }, [caseStats]);
  const lastPullMap = useMemo(() => {
    const map = new Map();
    const preferNewer = (a, b) => {
      const ta = Date.parse(a || '');
      const tb = Date.parse(b || '');
      if (Number.isNaN(ta) && Number.isNaN(tb)) return a || b || '—';
      if (Number.isNaN(ta)) return b;
      if (Number.isNaN(tb)) return a;
      return ta >= tb ? a : b;
    };

    // 1) Case stats job metadata if available
    (caseStats?.perCountyLastPull || []).forEach((item) => {
      if (!item?.county) return;
      const key = normCountyKey(item.county);
      const val = item.lastPull || item.finishedAt || '—';
      map.set(key, val);
    });

    // 2) KPI job metadata (server /kpis)
    (kpiData?.perCountyLastPull || []).forEach((item) => {
      if (!item?.county) return;
      const key = normCountyKey(item.county);
      const val = item.lastPull || item.finishedAt || '—';
      const prev = map.get(key) || '—';
      map.set(key, preferNewer(prev, val));
    });

    // 3) Fallback: last observed data timestamp per county (server /kpis)
    (kpiData?.perCountyLastData || []).forEach((item) => {
      if (!item?.county) return;
      const key = normCountyKey(item.county);
      const val = item.lastData || '—';
      const prev = map.get(key) || '—';
      map.set(key, preferNewer(prev, val));
    });

    return map;
  }, [caseStats, kpiData]);
  const new24Raw = useMemo(() => {
    if (Array.isArray(new24h?.items)) return new24h.items;
    if (Array.isArray(new24h)) return new24h;
    return [];
  }, [new24h]);

  const recentRaw = useMemo(() => {
    const src = recentData;
    if (Array.isArray(src?.items)) return src.items;
    if (Array.isArray(src)) return src;
    return [];
  }, [recentData]);

  const {
    data: attentionData,
    isLoading: attentionLoading,
  } = useCases(
    {
      attention: true,
      attentionType: 'refer',
      county: 'harris',
      noCount: true,
      limit: 25,
      sortBy: 'bond_amount',
      order: 'desc',
    },
    { staleTime: 60_000 }
  );

  const attentionRaw = useMemo(() => {
    if (Array.isArray(attentionData?.items)) return attentionData.items;
    if (Array.isArray(attentionData)) return attentionData;
    return [];
  }, [attentionData]);

  const attentionList = useMemo(
    () => applyContactFilter(attentionRaw, snapshotFilters.attention),
    [attentionRaw, snapshotFilters.attention]
  );

  const attentionCounts = useMemo(() => {
    const contacted = attentionRaw.filter((item) => item.contacted).length;
    const needs = attentionRaw.filter((item) => item.needs_attention).length;
    return {
      total: attentionRaw.length,
      contacted,
      uncontacted: attentionRaw.length - contacted,
      needs,
    };
  }, [attentionRaw]);

  const newSummary = useMemo(
    () =>
      new24h?.summary || {
        total: new24Raw.length,
        contacted: 0,
        uncontacted: new24Raw.length,
      },
    [new24h, new24Raw.length]
  );
  const recentSummary = useMemo(
    () =>
      recentData?.summary || {
        totalCount: recentRaw.length,
        contacted: 0,
        uncontacted: recentRaw.length,
      },
    [recentData, recentRaw.length]
  );

  const new24List = useMemo(
    () => applyContactFilter(new24Raw, snapshotFilters.new),
    [new24Raw, snapshotFilters.new]
  );
  const recentList = useMemo(
    () => applyContactFilter(recentRaw, snapshotFilters.recent),
    [recentRaw, snapshotFilters.recent]
  );

  const recentBreakdown = useMemo(() => {
    const now = Date.now();
    const total = recentList.length;
    let in48 = 0;
    let in72 = 0;

    const toHoursFromNow = (value) => {
      if (!value) return Number.POSITIVE_INFINITY;
      const isoLike = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00Z`
        : value;
      const parsed = new Date(isoLike);
      if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
      return (now - parsed.getTime()) / (1000 * 60 * 60);
    };

    recentList.forEach((item) => {
      const booked = item.booking_date || item.bookedAt || item.booked_at;
      const hours = toHoursFromNow(booked);
      if (hours >= 24 && hours < 48) in48 += 1;
      if (hours >= 48 && hours <= 72) in72 += 1;
    });

    return { total, in48, in72 };
  }, [recentList]);

  const snapshotRowsByTab = useMemo(
    () => ({
      top: (prioritizePhone ? top10Prioritized : top10List).map((item, index) =>
        shapeSnapshotRow(item, 'top', { key: item.id || `top-${index}` })
      ),
      new: new24List.map((item, index) =>
        shapeSnapshotRow(item, 'new', {
          key: item.id || `new-${index}`,
          windowLabel: '24h',
        })
      ),
      recent: recentList.map((item, index) =>
        shapeSnapshotRow(item, 'recent', {
          key: item.id || `recent-${index}`,
          windowLabel: '48–72h',
        })
      ),
      attention: attentionList.map((item, index) =>
        shapeSnapshotRow(item, 'attention', {
          key: item.id || item._id || `attention-${index}`,
          windowLabel: 'Attention',
        })
      ),
    }),
    [top10List, top10Prioritized, prioritizePhone, new24List, recentList, attentionList]
  );

  const snapshotSummaries = useMemo(
    () => ({
      top: {
        total: top10Counts.total,
        contacted: top10Counts.contacted,
        uncontacted: top10Counts.uncontacted,
        fallbackWindow: topFallbackNotice ? topWindowUsed : null,
      },
      new: {
        total: newSummary.total,
        contacted: newSummary.contacted,
        uncontacted: newSummary.uncontacted,
      },
      recent: {
        total: recentSummary.totalCount ?? recentSummary.total ?? recentBreakdown.total,
        contacted: recentSummary.contacted ?? 0,
        uncontacted:
          recentSummary.uncontacted ??
          (recentSummary.totalCount != null
            ? recentSummary.totalCount - (recentSummary.contacted || 0)
            : recentBreakdown.total - (recentSummary.contacted || 0)),
        in48: recentBreakdown.in48,
        in72: recentBreakdown.in72,
      },
      attention: {
        total: attentionCounts.total,
        contacted: attentionCounts.contacted,
        uncontacted: attentionCounts.uncontacted,
        needs: attentionCounts.needs,
        refer: attentionSummary?.refer ?? null,
        missingDocs: attentionSummary?.missingDocs ?? null,
      },
    }),
    [
      top10Counts,
      topFallbackNotice,
      topWindowUsed,
      newSummary,
      recentSummary,
      recentBreakdown,
      attentionCounts,
      attentionSummary,
    ]
  );

  const new24ByCounty = useMemo(() => {
    const m = new Map();
    ALL_COUNTIES.forEach((c) => m.set(c, 0));
    new24List.forEach((r) => {
      const key = normCountyKey(r.county);
      const v = Number(r.bond_amount ?? 0) || 0;
      m.set(key, (m.get(key) || 0) + v);
    });
    return m;
  }, [new24List]);

  const recentByCounty = useMemo(() => {
    const m = new Map();
    ALL_COUNTIES.forEach((c) => m.set(c, 0));
    recentList.forEach((r) => {
      const key = normCountyKey(r.county);
      const v = Number(r.bond_amount ?? 0) || 0;
      m.set(key, (m.get(key) || 0) + v);
    });
    return m;
  }, [recentList]);

  // Trends helpers
  const trendLabels = Array.isArray(countyTrends?.labels) ? countyTrends.labels : [];
  const seriesByCounty = useMemo(() => {
    const acc = {};
    if (Array.isArray(countyTrends?.bondSeriesArr)) {
      countyTrends.bondSeriesArr.forEach(({ name, data }) => {
        const key = normCountyKey(name);
        acc[key] = Array.isArray(data) ? data : [];
      });
    } else if (countyTrends?.bondSeries) {
      Object.entries(countyTrends.bondSeries).forEach(([name, data]) => {
        const key = normCountyKey(name);
        acc[key] = Array.isArray(data) ? data : [];
      });
    }
    ALL_COUNTIES.forEach((c) => {
      if (!acc[c]) acc[c] = Array(trendLabels.length).fill(0);
    });
    return acc;
  }, [countyTrends, trendLabels.length]);

  // Map window → index into trends labels (end-anchored)
  const windowToIndexFromEnd = { '24h': 1, '48h': 2, '72h': 3 };
  const trendIndex =
    trendLabels.length >= windowToIndexFromEnd[valueWindow]
      ? trendLabels.length - windowToIndexFromEnd[valueWindow]
      : null;

  const bondValueForWindow = useCallback(
    (county) => {
      const key = normCountyKey(county);

      if (valueWindow === '24h') {
        const pc = perCountyMap.get(key);
        if (pc && Number.isFinite(Number(pc.bondToday))) {
          return Number(pc.bondToday);
        }
        const live = new24ByCounty.get(key);
        if (Number.isFinite(Number(live))) {
          return Number(live);
        }
      }

      const arr = seriesByCounty[key] || [];
      if (trendIndex == null || trendIndex < 0 || trendIndex >= arr.length) {
        // '7d' / '30d' windows aren't in the trend-index map; use the per-county
        // API bondValue which is already scoped to the requested window.
        const pc = perCountyMap.get(key);
        const v = Number(pc?.bondValue ?? 0);
        return Number.isFinite(v) ? v : 0;
      }
      const v = Number(arr[trendIndex] || 0);
      return Number.isFinite(v) ? v : 0;
    },
    [valueWindow, perCountyMap, new24ByCounty, seriesByCounty, trendIndex]
  );

  const countyRows = useMemo(() => {
    return ALL_COUNTIES.map((name) => {
      const pc = perCountyMap.get(name) || {};
      const data = seriesByCounty[name] || [];
      const lastPull = lastPullMap.get(name) || '—';
      const new24 = Number(pc.counts?.today || 0);
      const new48 = Number(pc.counts?.yesterday || 0);
      const new72 = Number(pc.counts?.twoDaysAgo || 0);
      const new3to7 = Number(pc.counts?.threeToSeven || 0);
      const last7d = Number(pc.counts?.last7d || 0);
      const hasBond = pc.hasBond != null ? Number(pc.hasBond) : null;
      const totalVolume = new24 + new48 + new72 + new3to7;
      return {
        county: name,
        pretty: prettyCounty(name),
        valueTrend: data,
        new24,
        new48,
        new72,
        new3to7,
        last7d,
        hasBond,
        bondToday: Number(pc.bondToday || 0),
        bondWindowValue: bondValueForWindow(name),
        lastPull,
        flagged: isStalePull(lastPull),
        totalVolume,
      };
    });
  }, [perCountyMap, seriesByCounty, lastPullMap, bondValueForWindow]);

  const filteredCountyRows = useMemo(
    () => (countyAttentionOnly ? countyRows.filter((row) => row.flagged) : countyRows),
    [countyRows, countyAttentionOnly]
  );

  const sortedCountyRows = useMemo(() => {
    const rows = filteredCountyRows.slice();
    if (countySort === 'bond') {
      rows.sort((a, b) => b.bondWindowValue - a.bondWindowValue);
    } else if (countySort === 'volume') {
      rows.sort((a, b) => b.totalVolume - a.totalVolume);
    } else {
      rows.sort((a, b) => a.pretty.localeCompare(b.pretty));
    }
    return rows;
  }, [filteredCountyRows, countySort]);

  // KPIs (as provided by /kpis)
  const kpis = kpiData
    ? {
        new24: kpiData.newCountsBooked?.today ?? 0,
        new48: kpiData.newCountsBooked?.yesterday ?? 0,
        new72: kpiData.newCountsBooked?.twoDaysAgo ?? 0,
        new3to7: kpiData.newCountsBooked?.threeToSeven ?? 0,
        contacted24: kpiData.contacted24h ?? { contacted: 0, total: 0, rate: 0 },
      }
    : { new24: 0, new48: 0, new72: 0, new3to7: 0, contacted24: { contacted: 0, total: 0, rate: 0 } };
  
  // DEBUG: Log KPI data flow
  if (typeof console !== 'undefined' && kpiData) {
    console.log('[Dashboard] kpiData:', kpiData);
    console.log('[Dashboard] kpis (derived):', kpis);
  }

  // Remove global loading gate: render panels with their own lightweight loading states

  const CountyTicker = ({ map, windowLabel }) => (
    <div className="mb-3 flex flex-wrap gap-2">
      {ALL_COUNTIES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => navigate(`/cases?county=${encodeURIComponent(c)}&window=${windowLabel}`)}
          className="text-xs px-2 py-1 rounded-full border bg-white hover:bg-gray-50"
          title={`Open ${prettyCounty(c)} ${windowLabel}`}
        >
          <span className="mr-2">{prettyCounty(c)}</span>
          <span className="font-semibold">{money(map.get(c) || 0)}</span>
        </button>
      ))}
    </div>
  );

  const percent = (part, total) => (total ? Math.round((part / total) * 100) : 0);

  const activeRows = snapshotRowsByTab[snapshotTab] || [];
  const activeSummary = snapshotSummaries[snapshotTab] || {};
  const activeFilter = snapshotFilters[snapshotTab] || 'all';
  const emptyMessage = SNAPSHOT_EMPTY_COPY[snapshotTab] || 'Nothing to show here.';

  const formatCount = (value) => Number(value ?? 0).toLocaleString();

  const summaryChips = (() => {
    const chips = [];
    const showing = `Showing ${formatCount(activeRows.length)} of ${formatCount(activeSummary.total)}`;
    if (snapshotTab === 'top') {
      chips.push(showing);
      chips.push(`${formatCount(activeSummary.uncontacted)} uncontacted`);
      if (activeSummary.fallbackWindow) {
        chips.push(`Window fallback: ${activeSummary.fallbackWindow}`);
      }
      // Surface how many of the Top have a phone detected (helps explain prioritization)
      chips.push(`${formatCount(topHasPhoneCount)} with phone`);
    } else if (snapshotTab === 'new') {
      chips.push(showing);
      chips.push(`${formatCount(activeSummary.uncontacted)} uncontacted`);
    } else if (snapshotTab === 'recent') {
      chips.push(showing);
      chips.push(`${formatCount(activeSummary.uncontacted)} uncontacted`);
      chips.push(`48h: ${formatCount(activeSummary.in48)}`);
      chips.push(`72h: ${formatCount(activeSummary.in72)}`);
    } else if (snapshotTab === 'attention') {
      chips.push(showing);
      chips.push(`${formatCount(activeSummary.uncontacted)} uncontacted`);
      if (activeSummary.needs != null) {
        chips.push(`Needs attention: ${formatCount(activeSummary.needs)}`);
      }
      if (activeSummary.refer != null) {
        chips.push(`Refer to magistrate: ${formatCount(activeSummary.refer)}`);
      }
      if (activeSummary.missingDocs != null) {
        chips.push(`Missing docs: ${formatCount(activeSummary.missingDocs)}`);
      }
    } else {
      chips.push(showing);
    }
    return chips;
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-tight flex items-center gap-2">
            Bail Bonds Dashboard
            {apiMode === 'v2_buckets' ? (
              <span
                className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 border border-indigo-200"
                title="Using time_bucket_v2 canonical windows"
              >
                v2
              </span>
            ) : null}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 hidden sm:block">v0.1</span>
            <button
              type="button"
              onClick={toggleDebug}
              className="text-xs rounded-md border px-2 py-1 text-slate-600 hover:bg-slate-50"
              title="Toggle data wiring debug overlay"
            >
              {debug ? 'Hide Debug' : 'Show Debug'}
            </button>
            {debug ? (
              <button
                type="button"
                onClick={forceRefresh}
                className="text-xs rounded-md border px-2 py-1 text-slate-600 hover:bg-slate-50"
                title="Invalidate and refetch all dashboard queries"
              >
                Force refresh
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="New (24h)" value={kpis.new24} to="/cases?window=24h" />
          <KpiCard label="New (24–48h)" value={kpis.new48} to="/cases?window=48h" />
          {/* Toggleable KPI: 48–72h ↔ 3–7d (controls inline in card header) */}
          <KpiCard
            label={kpiRecentWindow === '3-7d' ? 'New (3–7d)' : 'New (48–72h)'}
            value={kpiRecentWindow === '3-7d' ? kpis.new3to7 : kpis.new72}
            to={`/cases?window=${kpiRecentWindow === '3-7d' ? '3-7d' : '72h'}`}
            right={
              <div className="inline-flex gap-1">
                <button
                  type="button"
                  className="px-2 py-1 text-[11px] rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700"
                  data-active={kpiRecentWindow === '48-72h'}
                  onClick={(e) => { e.preventDefault(); setKpiRecentWindow('48-72h'); }}
                >
                  48–72h
                </button>
                <button
                  type="button"
                  className="px-2 py-1 text-[11px] rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700"
                  data-active={kpiRecentWindow === '3-7d'}
                  onClick={(e) => { e.preventDefault(); setKpiRecentWindow('3-7d'); }}
                >
                  3–7d
                </button>
              </div>
            }
          />
          <KpiCard
            label="Contacted (24h)"
            value={`${kpis.contacted24.contacted}/${kpis.contacted24.total}`}
            sublabel={`${Math.round((kpis.contacted24.rate || 0) * 100)}%`}
            tone="success"
            to="/cases?window=24h&contacted=true"
          />
        </div>

        {/* Attention funnel + county bond value */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {attentionSummary ? (
            <Panel
              title="Attention funnel"
              subtitle="Snapshot of cases needing manual review"
              to="/reports"
            >
              <div className="space-y-4 text-sm text-slate-700">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500">

                {showDebugPanel ? <DashboardDebugPanel /> : null}
                    <span>Needs attention</span>
                    <span>
                      {attentionSummary.needs.toLocaleString()} ({percent(attentionSummary.needs, attentionSummary.total)}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-rose-400"
                      style={{ width: `${percent(attentionSummary.needs, attentionSummary.total)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
                  <div>
                    <div className="text-slate-500">Refer to magistrate</div>
                    <div className="text-sm font-semibold text-slate-800">{attentionSummary.refer.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Letter suffix</div>
                    <div className="text-sm font-semibold text-slate-800">{attentionSummary.letter.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Missing required docs</div>
                    <div className="text-sm font-semibold text-slate-800">{attentionSummary.missingDocs.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Total cases</div>
                    <div className="text-sm font-semibold text-slate-800">{attentionSummary.total.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel
            title={`County Bond Value (${perCountyWindowUsed})`}
            subtitle={`Sum of bond amounts for new bookings in the selected window${perCountyWindowUsed !== valueWindow ? ` • showing ${perCountyWindowUsed}` : ''}`}
            right={<WindowSwitcher value={valueWindow} onChange={setValueWindow} />}
          >
            <div className="grid grid-cols-2 gap-3">
              {ALL_COUNTIES.map((name) => {
                const amount = bondValueForWindow(name);
                const pc = perCountyMap.get(normCountyKey(name)) || {};
                const hasBond = pc.hasBond != null ? Number(pc.hasBond) : null;
                const last7dCount = Number(pc.counts?.last7d || 0);
                const bondDisplay = (hasBond === 0 && last7dCount > 0) ? 'N/A' : money(amount);
                return (
                  <div key={name} className="rounded-xl border p-3">
                    <div className="text-sm font-semibold text-slate-800">{prettyCounty(name)}</div>
                    <div className="text-slate-500 text-xs">{bondDisplay}</div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Top Charges by Bond Value */}
        {(() => {
          const chargeItems = Array.isArray(chargeBondsData?.items) ? chargeBondsData.items : [];
          const displayItems = showAllCharges ? chargeItems : chargeItems.slice(0, 10);
          const maxBond = chargeItems.length > 0 ? chargeItems[0].totalBond : 1;
          const chargeWindowBtn =
            'px-2 py-1 text-xs rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700';
          return (
            <Panel
              title="Top Charges by Bond Value"
              subtitle={`Charge types driving total bond across all counties — ${chargeBondsData?.county === 'all' ? 'all counties' : prettyCounty(chargeBondsData?.county || '')} • ${chargeBondsData?.window || chargeWindow}`}
              right={
                <div className="flex items-center gap-2">
                  <select
                    value={chargeCounty}
                    onChange={(e) => setChargeCounty(e.target.value)}
                    className="text-xs border rounded-md px-2 py-1 bg-white"
                  >
                    <option value="all">All Counties</option>
                    {['brazoria', 'fortbend', 'galveston', 'harris', 'jefferson'].map((c) => (
                      <option key={c} value={c}>{prettyCounty(c)}</option>
                    ))}
                  </select>
                  <div className="inline-flex gap-1">
                    {['24h', '48h', '72h', '7d'].map((w) => (
                      <button
                        key={w}
                        type="button"
                        className={chargeWindowBtn}
                        data-active={chargeWindow === w}
                        onClick={() => setChargeWindow(w)}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              }
            >
              {displayItems.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No charge data for this window</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500 border-b">
                        <th className="py-2 pr-3 font-semibold w-5"></th>
                        <th className="py-2 pr-4 font-semibold">Charge</th>
                        <th className="py-2 pr-4 font-semibold">Counties</th>
                        <th className="py-2 pr-4 text-right font-semibold">Total Bond</th>
                        <th className="py-2 pr-4 text-right font-semibold">Avg Bond</th>
                        <th className="py-2 text-right font-semibold">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayItems.map((item) => {
                        const barPct = maxBond > 0 ? Math.round((item.totalBond / maxBond) * 100) : 0;
                        const isOpen = expandedCharge === item.charge;
                        const details = Array.isArray(item.countyDetails) ? item.countyDetails : [];
                        const samples = Array.isArray(item.samples) ? item.samples : [];

                        // Compact county cell: show top county + overflow count
                        const countyLabel = (() => {
                          if (details.length === 0) return '—';
                          if (details.length === 1) return prettyCounty(details[0].county);
                          return `${prettyCounty(details[0].county)} +${details.length - 1}`;
                        })();
                        const countyTitle = details.map((d) => prettyCounty(d.county)).join(', ');

                        return (
                          <>
                            <tr
                              key={item.charge}
                              className={`border-b last:border-0 hover:bg-slate-50 cursor-pointer select-none${isOpen ? ' bg-slate-50' : ''}`}
                              onClick={() => setExpandedCharge(isOpen ? null : item.charge)}
                            >
                              <td className="py-2 pr-3 text-slate-400 text-center">
                                {isOpen ? '▾' : '▸'}
                              </td>
                              <td className="py-2 pr-4">
                                <div className="font-medium text-slate-800 truncate max-w-[260px]" title={item.charge}>
                                  {item.charge}
                                </div>
                                <div className="mt-1 h-1.5 rounded-full bg-blue-100" aria-hidden="true">
                                  <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${barPct}%` }} />
                                </div>
                              </td>
                              <td className="py-2 pr-4 text-slate-500 whitespace-nowrap" title={countyTitle}>
                                {countyLabel}
                              </td>
                              <td className="py-2 pr-4 text-right font-semibold text-slate-800">
                                {money(item.totalBond)}
                              </td>
                              <td className="py-2 pr-4 text-right text-slate-500">
                                {money(item.avgBond)}
                              </td>
                              <td className="py-2 text-right text-slate-500">{item.count}</td>
                            </tr>
                            {isOpen && (
                              <tr key={`${item.charge}__accordion`} className="bg-slate-50">
                                <td colSpan={6} className="px-4 pb-4 pt-2">
                                  <div className="flex flex-col gap-4">
                                    {/* County Breakdown */}
                                    {details.length > 0 ? (
                                      <div>
                                        <p className="text-xs font-semibold text-slate-600 mb-1">County Breakdown</p>
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="text-left text-slate-400 border-b">
                                              <th className="py-1 pr-4 font-medium">County</th>
                                              <th className="py-1 pr-4 text-right font-medium">Count</th>
                                              <th className="py-1 pr-4 text-right font-medium">Total Bond</th>
                                              <th className="py-1 text-right font-medium">Avg Bond</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {details.map((d) => (
                                              <tr key={d.county} className="border-b last:border-0">
                                                <td className="py-1 pr-4 text-slate-700 font-medium">{prettyCounty(d.county)}</td>
                                                <td className="py-1 pr-4 text-right text-slate-500">{d.count}</td>
                                                <td className="py-1 pr-4 text-right text-slate-700">{money(d.totalBond)}</td>
                                                <td className="py-1 text-right text-slate-500">{money(d.avgBond)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-400">County detail unavailable</p>
                                    )}

                                    {/* Sample Records */}
                                    {samples.length > 0 ? (
                                      <div>
                                        <p className="text-xs font-semibold text-slate-600 mb-1">Sample Records (top by bond)</p>
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="text-left text-slate-400 border-b">
                                              <th className="py-1 pr-4 font-medium">Name</th>
                                              <th className="py-1 pr-4 font-medium">County</th>
                                              <th className="py-1 pr-4 font-medium">Date</th>
                                              <th className="py-1 text-right font-medium">Bond</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {samples.map((s, idx) => (
                                              <tr key={idx} className="border-b last:border-0">
                                                <td className="py-1 pr-4 text-slate-700">{s.full_name || '—'}</td>
                                                <td className="py-1 pr-4 text-slate-500">{s.county ? prettyCounty(s.county) : '—'}</td>
                                                <td className="py-1 pr-4 text-slate-500">{s.booking_date || '—'}</td>
                                                <td className="py-1 text-right text-slate-700">{money(s.bond_amount)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-400">No sample records available</p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                  {chargeItems.length > 10 && (
                    <div className="mt-3 text-center">
                      <button
                        type="button"
                        onClick={() => setShowAllCharges((v) => !v)}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        {showAllCharges ? 'Show less' : `View all ${chargeItems.length} charges`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          );
        })()}

        {/* Snapshot panel with tabs */}
        <Panel
          title="Inmate Snapshot"
          subtitle="Top value, fresh bookings, and urgent follow ups"
        >
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
              {SNAPSHOT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSnapshotTab(tab.id)}
                  data-active={snapshotTab === tab.id}
                  className="rounded-full border px-3 py-1 transition hover:bg-slate-50 data-[active=true]:border-blue-300 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-700"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              {SNAPSHOT_CONTACT_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setSnapshotFilter(snapshotTab, filter.id)}
                  data-active={activeFilter === filter.id}
                  className="rounded-full border px-2 py-1 transition hover:bg-slate-50 data-[active=true]:border-blue-300 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-700"
                >
                  {filter.label}
                </button>
              ))}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {summaryChips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-500"
                  >
                    {chip}
                  </span>
                ))}
                {snapshotTab === 'top' ? (
                  <div className="ml-auto flex items-center gap-3">
                    <WindowSwitcher value={valueWindow} onChange={setValueWindow} />
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={prioritizePhone}
                        onChange={(e) => setPrioritizePhone(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      Prioritize phone numbers
                    </label>
                  </div>
                ) : null}
              </div>
            </div>

            {snapshotTab === 'top' && topFallbackNotice ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                No bookings in the last 24h. Showing {topWindowUsed} window instead.
              </div>
            ) : null}

            {snapshotTab === 'attention' && attentionSummary ? (
              <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                Priority counts mirror the funnel above so the team can act on the highest risk items first.
              </div>
            ) : null}

            {snapshotTab === 'new' ? <CountyTicker map={new24ByCounty} windowLabel="24h" /> : null}
            {snapshotTab === 'recent' ? (
              <div className="flex items-center gap-2 w-full">
                <CountyTicker map={recentByCounty} windowLabel={recentWindow === '3-7d' ? '3-7d' : '48-72h'} />
                <div className="ml-auto inline-flex gap-1">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700"
                    data-active={recentWindow === '48-72h'}
                    onClick={() => setRecentWindow('48-72h')}
                  >
                    48–72h
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700"
                    data-active={recentWindow === '3-7d'}
                    onClick={() => setRecentWindow('3-7d')}
                  >
                    3–7d
                  </button>
                </div>
              </div>
            ) : null}
            {snapshotTab === 'recent' ? (
              <div className="flex items-center gap-2">
                <CountyTicker map={recentByCounty} windowLabel={recentWindow === '3-7d' ? '3-7d' : '48-72h'} />
                <div className="ml-auto inline-flex gap-1">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700"
                    data-active={recentWindow === '48-72h'}
                    onClick={() => setRecentWindow('48-72h')}
                  >
                    48–72h
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-gray-50 data-[active=true]:bg-blue-50 data-[active=true]:border-blue-300 data-[active=true]:text-blue-700"
                    data-active={recentWindow === '3-7d'}
                    onClick={() => setRecentWindow('3-7d')}
                  >
                    3–7d
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500">
                  <tr className="border-b">
                    <th className="py-2 pr-4 text-left font-semibold">Person</th>
                    <th className="py-2 pr-4 text-left font-semibold">County</th>
                    <th className="py-2 pr-4 text-left font-semibold">Booked</th>
                    <th className="py-2 pr-4 text-left font-semibold">Bond</th>
                    <th className="py-2 pr-4 text-left font-semibold">Offense</th>
                    <th className="py-2 pr-4 text-left font-semibold">Agency / Facility</th>
                    <th className="py-2 text-left font-semibold">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {/* Targeted loading row per active tab to avoid showing empty-state during fetch */}
                  {(() => {
                    const activeLoading =
                      (snapshotTab === 'top' && _topLoading) ||
                      (snapshotTab === 'new' && _new24Loading) ||
                      (snapshotTab === 'recent' && recentLoading) ||
                      (snapshotTab === 'attention' && attentionLoading);
                    if (activeLoading) {
                      return (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-slate-500">
                            Loading {snapshotTab}…
                          </td>
                        </tr>
                      );
                    }
                    return null;
                  })()}
                  {activeRows.map((row, index) => {
                    const lastContact = safeDateLabel(row.lastContact);
                    return (
                      <tr key={row.key || `${snapshotTab}-${index}`} className="align-top">
                        <td className="py-2 pr-4 font-medium text-slate-800 align-top">
                          {row.caseId ? (
                            <Link to={`/cases/${row.caseId}`} className="text-blue-600 hover:text-blue-700">
                              {row.name}
                            </Link>
                          ) : (
                            <span>{row.name}</span>
                          )}
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-600">
                            {row.sex ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 uppercase tracking-wide">
                                {row.sex}
                              </span>
                            ) : null}
                            {row.race ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5">
                                {row.race}
                              </span>
                            ) : null}
                            {row.windowLabel ? (
                              <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-blue-600">
                                {row.windowLabel}
                              </span>
                            ) : null}
                            {row.mappedWindow ? (
                              <span
                                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] ${bucketClasses(row.timeBucketV2)}`}
                                title={row.bookingDateTime ? `Booked: ${row.bookingDateTime}` : ''}
                              >
                                {row.mappedWindow}
                              </span>
                            ) : null}
                            {row.timeBucketV2 && !row.mappedWindow ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px]">
                                {row.timeBucketV2}
                              </span>
                            ) : null}
                            {row.category ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5">
                                {formatLabel(row.category)}
                              </span>
                            ) : null}
                            {row.needsAttention ? (
                              <span className="inline-flex items-center rounded-md bg-rose-100 px-1.5 py-0.5 text-rose-700">
                                Needs attention
                              </span>
                            ) : null}
                            {row.attentionReasons.slice(0, 2).map((reason) => (
                              <span
                                key={reason}
                                className="inline-flex items-center rounded-md bg-rose-50 px-1.5 py-0.5 text-rose-600"
                              >
                                {formatLabel(reason)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-slate-700 align-top">{row.county}</td>
                        <td className="py-2 pr-4 text-slate-700 align-top">{row.booked || '—'}</td>
                        <td className="py-2 pr-4 text-slate-700 align-top">
                          <BondDisplay amount={row.bondAmount} status={row.bondStatus} raw={row.bondRaw} />
                        </td>
                        <td className="py-2 pr-4 text-slate-700 align-top truncate max-w-[36ch]">{row.offense || '—'}</td>
                        <td className="py-2 pr-4 text-slate-700 align-top truncate max-w-[28ch]">{row.agency || '—'}</td>
                        <td className="py-2 align-top">
                          {row.contacted ? (
                            <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs text-green-700">
                              Contacted
                            </span>
                          ) : row.caseId ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/messages?compose=initial&case=${row.caseId}`)}
                              className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"
                            >
                              Send outreach
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">No outreach available</span>
                          )}
                          {row.caseId && contactMeta[row.caseId]?.hasPhone ? (
                            <div className="mt-1 inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                              Phone on file
                            </div>
                          ) : null}
                          {lastContact ? (
                            <div className="mt-1 text-[10px] text-slate-400">Last contact {lastContact}</div>
                          ) : null}
                          {row.caseId ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => navigate(`/cases/${row.caseId}`)}
                                className="text-xs inline-flex items-center rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-700"
                              >
                                Open case
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/cases/${row.caseId}?tab=checklist`)}
                                className="text-xs inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:border-blue-300 hover:text-blue-700"
                              >
                                Checklist
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {activeRows.length === 0 && !((snapshotTab === 'top' && _topLoading) || (snapshotTab === 'new' && _new24Loading) || (snapshotTab === 'recent' && recentLoading) || (snapshotTab === 'attention' && attentionLoading)) ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        {emptyMessage}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>

        {/* County trends */}
        <Panel title="County Trends (last 7 days)" subtitle="New vs aging volume and bond value">
          {sortedCountyRows.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedCountyRows.map((c) => (
                <div key={c.county} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-800">{c.pretty}</div>
                    <div className="text-xs text-slate-500">Today: {money(c.bondToday)}</div>
                  </div>
                  <div className="mt-3">
                    <MiniStackedBar new24={c.new24} new48={c.new48} new72={c.new72} new3to7={c.new3to7} />
                  </div>
                  <div className="mt-3 text-[10px] text-slate-500 flex items-center gap-3">
                    <span className="inline-block w-3 h-3 bg-green-400 rounded-sm" /> 24h
                    <span className="inline-block w-3 h-3 bg-amber-400 rounded-sm" /> 48h
                    <span className="inline-block w-3 h-3 bg-red-400 rounded-sm" /> 72h
                    <span className="inline-block w-3 h-3 bg-purple-400 rounded-sm" /> 3–7d
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    7d total: <span className="font-semibold">{c.last7d.toLocaleString()}</span>
                  </div>
                  <div className="mt-3 text-xs text-slate-500">Bond value (7d)</div>
                  <Sparkline values={Array.isArray(c.valueTrend) ? c.valueTrend : []} />
                  {c.flagged ? (
                    <div className="mt-3 inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                      Data pull is stale
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              All counties are up to date for this filter.
            </div>
          )}
        </Panel>

        {/* Counties Overview */}
        <Panel
          title="Counties Overview"
          subtitle="Pull status and daily value by county"
          to="/cases"
          right={
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1">
                {COUNTY_SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setCountySort(opt.id)}
                    data-active={countySort === opt.id}
                    className="rounded-full px-2 py-1 transition hover:bg-slate-50 data-[active=true]:border-blue-300 data-[active=true]:bg-blue-50 data-[active=true]:text-blue-700"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1">
                <input
                  id="county-attention-only"
                  name="countyAttentionOnly"
                  type="checkbox"
                  className="h-3 w-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={countyAttentionOnly}
                  onChange={(event) => setCountyAttentionOnly(event.target.checked)}
                />
                Attention only
              </label>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b">
                  <th className="py-2 pr-3 text-left font-semibold">County</th>
                  <th className="py-2 pr-3 text-right font-semibold">24h</th>
                  <th className="py-2 pr-3 text-right font-semibold">48h</th>
                  <th className="py-2 pr-3 text-right font-semibold">72h</th>
                  <th className="py-2 pr-3 text-right font-semibold">3–7d</th>
                  <th className="py-2 pr-3 text-right font-semibold">7d total</th>
                  <th className="py-2 pr-3 text-right font-semibold">Bond ({valueWindow})</th>
                  <th className="py-2 pr-3 text-left font-semibold">Trend (7d)</th>
                  <th className="py-2 pr-3 text-left font-semibold">Last pull</th>
                  <th className="py-2 pr-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-slate-700">
                {sortedCountyRows.length ? (
                  sortedCountyRows.map((c) => (
                    <tr key={c.county} className="hover:bg-slate-50">
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        <div className="flex items-center gap-2">
                          <span>{c.pretty}</span>
                          {c.flagged ? (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                              Needs attention
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right">{c.new24.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right">{c.new48.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right">{c.new72.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right">{c.new3to7.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{c.last7d.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right">{c.hasBond === 0 && c.last7d > 0 ? 'N/A' : money(c.bondWindowValue)}</td>
                      <td className="py-2 pr-3"><Sparkline values={Array.isArray(c.valueTrend) ? c.valueTrend : []} /></td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {c.lastPull === '—' ? '—' : new Date(c.lastPull).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1 text-xs">
                          <button
                            type="button"
                            onClick={() => navigate(`/cases?county=${encodeURIComponent(c.county)}&window=${valueWindow}`)}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-700"
                          >
                            View cases
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/reports?county=${encodeURIComponent(c.county)}`)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:border-blue-300 hover:text-blue-700"
                          >
                            Trend
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-slate-500">
                      All counties are clear for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
      {debug ? (
        debugMin ? (
          <div className="fixed right-4 bottom-4 z-50 max-w-sm text-xs">
            <div className="rounded-full border shadow-md bg-white px-2 py-1 flex items-center gap-2">
              <span className="text-[11px] text-slate-700">Debug</span>
              <button
                type="button"
                onClick={toggleDebugMin}
                className="text-[10px] rounded-md border px-2 py-0.5 hover:bg-slate-50"
                title="Expand debug window"
              >Expand</button>
              <button
                type="button"
                onClick={forceRefresh}
                className="text-[10px] rounded-md border px-2 py-0.5 hover:bg-slate-50"
                title="Invalidate and refetch dashboard queries"
              >Refresh</button>
              <button
                type="button"
                onClick={toggleDebug}
                className="text-[10px] text-blue-600 hover:text-blue-700"
                title="Hide debug window"
              >Hide</button>
            </div>
          </div>
        ) : (
          <div className="fixed right-4 bottom-4 z-50 max-w-sm w-[360px] text-xs">
            <div className="rounded-xl border shadow-xl bg-white p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-800">Data Wiring Debug</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={forceRefresh}
                    className="text-[10px] rounded-md border px-2 py-0.5 hover:bg-slate-50"
                    title="Invalidate and refetch dashboard queries"
                  >Refresh</button>
                  <button
                    onClick={toggleDebugMin}
                    className="text-[10px] rounded-md border px-2 py-0.5 hover:bg-slate-50"
                    title="Minimize debug window"
                  >Minimize</button>
                  <button onClick={toggleDebug} className="text-[10px] text-blue-600 hover:text-blue-700">close</button>
                </div>
              </div>
              <DebugBlock
                kpiData={kpiData}
                perCountyMap={perCountyMap}
                new24List={new24List}
                recentList={recentList}
                lastPullMap={lastPullMap}
                valueWindow={valueWindow}
                perCountyWindowUsed={perCountyWindowUsed}
                topWindowUsed={topWindowUsed}
                topFallbackNotice={topFallbackNotice}
                trendLabels={trendLabels}
                seriesByCounty={seriesByCounty}
              />
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

function DebugBlock({ kpiData, perCountyMap, new24List, recentList, lastPullMap, valueWindow, perCountyWindowUsed, topWindowUsed, topFallbackNotice, trendLabels, seriesByCounty }) {
  const [county, setCounty] = useState('harris');
  const countyKey = normCountyKey(county);
  const pc = perCountyMap.get(countyKey) || {};
  const kpis = kpiData?.newCountsBooked || {};
  const new24Count = (new24List || []).filter((r) => normCountyKey(r.county) === countyKey).length;
  const recentCount = (recentList || []).filter((r) => normCountyKey(r.county) === countyKey).length;
  const lastPull = lastPullMap.get(countyKey) || '—';

  const labels = Array.isArray(trendLabels) ? trendLabels : [];
  const [dayIdx, setDayIdx] = useState(() => (labels.length ? labels.length - 1 : 0));
  useEffect(() => {
    if (labels.length && (dayIdx < 0 || dayIdx >= labels.length)) {
      setDayIdx(labels.length - 1);
    }
  }, [labels.length, dayIdx]);
  const series = (seriesByCounty && seriesByCounty[countyKey]) || [];
  const selectedDayLabel = labels[dayIdx] || '—';
  const selectedDayValue = Number(series[dayIdx] || 0);

  return (
    <div className="text-slate-700 space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[11px] text-slate-500">Snapshot vs API windows</div>
        <select
          className="ml-auto text-[11px] border rounded-md px-1 py-0.5"
          value={county}
          onChange={(e) => setCounty(e.target.value)}
          title="Select county"
        >
          {ALL_COUNTIES.map((c) => (
            <option key={c} value={c}>{prettyCounty(c)}</option>
          ))}
        </select>
        <select
          className="text-[11px] border rounded-md px-1 py-0.5"
          value={dayIdx}
          onChange={(e) => setDayIdx(Number(e.target.value))}
          title="Select day (trends)"
        >
          {labels.map((label, idx) => (
            <option key={idx} value={idx}>{label}</option>
          ))}
        </select>
      </div>
      <table className="min-w-full">
        <tbody>
          <tr>
            <td className="pr-2 text-slate-500">KPI Today (24h)</td>
            <td className="font-semibold">{Number(kpis.today ?? 0).toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pr-2 text-slate-500">Per-County {prettyCounty(county)} 24h</td>
            <td className="font-semibold">{Number(pc?.counts?.today ?? 0).toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pr-2 text-slate-500">New list (24h) {prettyCounty(county)} rows</td>
            <td className="font-semibold">{Number(new24Count || 0).toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pr-2 text-slate-500">Recent list (48–72h) {prettyCounty(county)} rows</td>
            <td className="font-semibold">{Number(recentCount || 0).toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pr-2 text-slate-500">Per-County {prettyCounty(county)} 24–48h</td>
            <td className="font-semibold">{Number(pc?.counts?.yesterday ?? 0).toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pr-2 text-slate-500">Per-County {prettyCounty(county)} 48–72h</td>
            <td className="font-semibold">{Number(pc?.counts?.twoDaysAgo ?? 0).toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pr-2 text-slate-500">Last pull ({prettyCounty(county)})</td>
            <td className="font-semibold">{lastPull === '—' ? '—' : new Date(lastPull).toLocaleString()}</td>
          </tr>
          <tr>
            <td className="pr-2 text-slate-500">Trends value ({selectedDayLabel})</td>
            <td className="font-semibold">{money(selectedDayValue)}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[11px] text-slate-500 mt-1">If numbers above disagree, check Network tab for /dashboard/kpis, /dashboard/per-county?window=24h, /dashboard/new.</div>

      <div className="mt-2 border-t pt-2">
        <div className="font-semibold text-slate-800 mb-1">Window → Data source map</div>
        <ul className="list-disc pl-4 space-y-1">
          <li className="whitespace-pre-line">
            KPI cards
            <div className="text-[11px] text-slate-500">GET /dashboard/kpis → newCountsBooked.today (24h), newCountsBooked.yesterday (24–48h), newCountsBooked.twoDaysAgo (48–72h)</div>
          </li>
          <li className="whitespace-pre-line">
            County Bond Value ({perCountyWindowUsed})
            <div className="text-[11px] text-slate-500">GET /dashboard/per-county?window={valueWindow} → item.bondToday (when 24h) or trends fallback for other windows; effective windowUsed={perCountyWindowUsed}</div>
          </li>
          <li className="whitespace-pre-line">
            Top value ({topWindowUsed})
            <div className="text-[11px] text-slate-500">GET /dashboard/top?window={valueWindow}&limit=10 → payload may include window_used; fallback? {topFallbackNotice ? 'yes' : 'no'}</div>
          </li>
          <li className="whitespace-pre-line">
            New (24h) list
            <div className="text-[11px] text-slate-500">GET /dashboard/new?scope=all → items[] (last 24h by scraped_at_dt/normalized_at_dt AND booked today or yesterday)</div>
          </li>
          <li className="whitespace-pre-line">
            Recent (48–72h) list
            <div className="text-[11px] text-slate-500">GET /dashboard/recent?limit=… → items[]; server window bands by booking time since/until</div>
          </li>
          <li className="whitespace-pre-line">
            County Trends (7d)
            <div className="text-[11px] text-slate-500">GET /dashboard/trends?days=7 → bondSeries per county; UI indexes latest day for 24h/48h/72h when bondToday not applicable</div>
          </li>
          <li className="whitespace-pre-line">
            Last pull timestamp per county
            <div className="text-[11px] text-slate-500">caseStats.perCountyLastPull ∪ kpis.perCountyLastPull ∪ kpis.perCountyLastData (newest wins)</div>
          </li>
        </ul>
      </div>

      <ProbeSection county={county} countyKey={countyKey} selectedDayLabel={selectedDayLabel} />

      <BoundsSection />
    </div>
  );
}

function BoundsSection() {
  const now = Date.now();
  const fmt = (ts) => new Date(ts).toLocaleString();
  const bands = [
    { label: '24h', since: now - 24 * 3600 * 1000, until: null },
    { label: '48h', since: now - 48 * 3600 * 1000, until: now - 24 * 3600 * 1000 },
    { label: '72h', since: now - 72 * 3600 * 1000, until: now - 48 * 3600 * 1000 },
  ];
  return (
    <div className="mt-2 border-t pt-2">
      <div className="font-semibold text-slate-800 mb-1">Window bounds (client clock)</div>
      <table className="min-w-full text-[11px]">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left">Window</th>
            <th className="text-left">Since</th>
            <th className="text-left">Until</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.label}>
              <td className="py-0.5 pr-2">{b.label}</td>
              <td className="py-0.5 pr-2">{fmt(b.since)}</td>
              <td className="py-0.5 pr-2">{b.until ? fmt(b.until) : 'now'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-slate-500 mt-1">Server windows are computed in America/Chicago and may differ slightly if your local timezone is different.</div>
    </div>
  );
}

function ProbeSection({ county, countyKey, selectedDayLabel }) {
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState({});

  const runProbe = useCallback(async (name, url, parse) => {
    setBusy(true);
    const started = performance.now();
    let status = 0, ok = false, ms = 0, summary = '', data = null;
    try {
      const auth = await getAuthHeader();
      const res = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache', ...(auth||{}) },
        credentials: 'include',
      });
      status = res.status;
      ok = res.ok;
      data = await res.json().catch(() => null);
      summary = parse ? parse(data) : '';
    } catch (err) {
      summary = String(err?.message || err);
    } finally {
      ms = Math.round(performance.now() - started);
      setProbe((prev) => ({ ...prev, [name]: { status, ok, ms, summary, url } }));
      setBusy(false);
    }
  }, []);

  const copyCurl = (url) => {
    const cmd = `curl -s "${url}" | jq .`;
    navigator.clipboard?.writeText(cmd);
  };

  const Row = ({ name, url, parse }) => (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => runProbe(name, url, parse)}
        className="text-[11px] rounded-md border px-2 py-0.5 hover:bg-slate-50 disabled:opacity-50"
      >
        Probe
      </button>
      <span className="text-[11px] text-slate-500 truncate" title={url}>{url}</span>
      <button
        type="button"
        onClick={() => copyCurl(url)}
        className="ml-auto text-[10px] text-blue-600 hover:text-blue-700"
        title="Copy cURL"
      >curl</button>
      {probe[name] ? (
        <span className={`text-[11px] ${probe[name].ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {probe[name].status} • {probe[name].ms}ms • {probe[name].summary}
        </span>
      ) : null}
    </div>
  );

  const base = `${API_BASE}/dashboard`;
  const harrisOnly = (items = []) => items.find((x) => normCountyKey(x.county) === countyKey) || {};

  return (
    <div className="mt-2 border-t pt-2 space-y-1">
      <div className="font-semibold text-slate-800">Quick API probes</div>
      <Row
        name="kpis"
        url={`${base}/kpis`}
        parse={(d) => `today=${d?.newCountsBooked?.today ?? 0}`}
      />
      <Row
        name="pc24"
        url={`${base}/per-county?window=24h`}
        parse={(d) => {
          const it = harrisOnly(d?.items || []);
          const n = Number(it?.counts?.today || 0);
          return `${prettyCounty(county)} 24h=${n}`;
        }}
      />
      <Row
        name="pc48"
        url={`${base}/per-county?window=48h`}
        parse={(d) => {
          const it = harrisOnly(d?.items || []);
          const n = Number(it?.counts?.yesterday || 0);
          return `${prettyCounty(county)} 24–48h=${n}`;
        }}
      />
      <Row
        name="pc72"
        url={`${base}/per-county?window=72h`}
        parse={(d) => {
          const it = harrisOnly(d?.items || []);
          const n = Number(it?.counts?.twoDaysAgo || 0);
          return `${prettyCounty(county)} 48–72h=${n}`;
        }}
      />
      <Row
        name="new"
        url={`${base}/new?scope=all&limit=5`}
        parse={(d) => {
          const arr = Array.isArray(d?.items) ? d.items : [];
          const n = arr.filter((r) => normCountyKey(r.county) === countyKey).length;
          return `New (24h) ${prettyCounty(county)} rows=${n}`;
        }}
      />
      <Row
        name="recent"
        url={`${base}/recent?limit=5`}
        parse={(d) => {
          const arr = Array.isArray(d?.items) ? d.items : [];
          const n = arr.filter((r) => normCountyKey(r.county) === countyKey).length;
          return `Recent (48–72h) ${prettyCounty(county)} rows=${n}`;
        }}
      />
      <div className="text-[10px] text-slate-500">Tip: Use the “curl” buttons to reproduce in your terminal. Selected county: {prettyCounty(county)} • Day: {selectedDayLabel}</div>
    </div>
  );
}
