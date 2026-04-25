import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useKpis,
  useTopByValue,
  usePerCounty,
  useCountyTrends,
  useNewToday,
  useRecent48to72,
} from '../hooks/dashboard';

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

function MiniStackedBar({ new24, new48, new72 }) {
  const total = Math.max((new24 || 0) + (new48 || 0) + (new72 || 0), 0.0001);
  const p24 = (new24 / total) * 100;
  const p48 = (new48 / total) * 100;
  const p72 = (new72 / total) * 100;
  return (
    <div className="w-full">
      <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full bg-green-400 inline-block" style={{ width: `${p24}%` }} />
        <div className="h-full bg-amber-400 inline-block" style={{ width: `${p48}%` }} />
        <div className="h-full bg-red-400 inline-block" style={{ width: `${p72}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>24h: {new24 || 0}</span>
        <span>48h: {new48 || 0}</span>
        <span>72h: {new72 || 0}</span>
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

function KpiCard({ label, value, sublabel, tone = 'default', to }) {
  const base = 'rounded-2xl border shadow-sm p-4 bg-white';
  const tones = {
    default: '',
    success: 'ring-1 ring-green-100',
    warn: 'ring-1 ring-amber-100',
    danger: 'ring-1 ring-red-100',
  };
  const content = (
    <div className={`${base} ${tones[tone]}`}>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-xl font-bold text-slate-800 sm:text-2xl">{value}</div>
        {sublabel ? <div className="text-xs text-slate-500">{sublabel}</div> : null}
      </div>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

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

function CountyCard({ county, lastPull, new24, new48, new72, contacted24, bondValue, label }) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-800">{label || county}</div>
        <div className="text-xs text-slate-500">Last pull: {lastPull}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="font-semibold text-slate-800">{new24}</div>
          <div className="text-slate-500">New 24h</div>
        </div>
        <div>
          <div className="font-semibold text-slate-800">{new48}</div>
          <div className="text-slate-500">New 48h</div>
        </div>
        <div>
          <div className="font-semibold text-slate-800">{new72}</div>
          <div className="text-slate-500">New 72h</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="font-semibold text-slate-800">{contacted24}</div>
          <div className="text-slate-500">Contacted 24h</div>
        </div>
        <div>
          <div className="font-semibold text-slate-800">{money(bondValue)}</div>
          <div className="text-slate-500">Bond value (window)</div>
        </div>
      </div>
      <div className="mt-3">
        <Link
          to={`/cases?county=${encodeURIComponent(county)}&window=24h`}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          Open county →
        </Link>
      </div>
    </div>
  );
}

export default function DashboardScreen() {
  const navigate = useNavigate();

  // ── Queries
  const { data: kpiData, isLoading: kpisLoading } = useKpis();
  const [valueWindow, setValueWindow] = useState('24h'); // affects both Top10 and Bond Value panel
  const { data: top10, isLoading: topLoading } = useTopByValue(valueWindow, 10);
  const { data: perCounty, isLoading: perCountyLoading } = usePerCounty('today');
  const { data: countyTrends, isLoading: trendsLoading } = useCountyTrends(7);
  const { data: new24h, isLoading: new24Loading } = useNewToday('all');
  const { data: recent48to72, isLoading: recentLoading } = useRecent48to72(10);
  const [topContactFilter, setTopContactFilter] = useState('all');

  const [newContactFilter, setNewContactFilter] = useState('all');
  const [recentContactFilter, setRecentContactFilter] = useState('all');

  // ── Normalize
  const perCountyItems = useMemo(
    () => (Array.isArray(perCounty?.items) ? perCounty.items : []),
    [perCounty]
  );
  const perCountyMap = useMemo(() => {
    const m = new Map();
    perCountyItems.forEach((c) => {
      m.set(normCountyKey(c.county), c);
    });
    return m;
  }, [perCountyItems]);

  const top10Raw = useMemo(() => (Array.isArray(top10) ? top10 : []), [top10]);
  const topWindowUsed = top10Raw.length ? (top10Raw[0].window_used || valueWindow) : valueWindow;
  const topFallbackNotice = top10Raw.length > 0 && topWindowUsed !== valueWindow;
  const filterTop = (list, filter) => {
    if (filter === 'contacted') return list.filter((item) => item.contacted);
    if (filter === 'uncontacted') return list.filter((item) => !item.contacted);
    return list;
  };
  const top10List = useMemo(() => filterTop(top10Raw, topContactFilter), [top10Raw, topContactFilter]);
  const top10Counts = useMemo(() => {
    const contacted = top10Raw.filter((item) => item.contacted).length;
    return {
      total: top10Raw.length,
      contacted,
      uncontacted: top10Raw.length - contacted,
    };
  }, [top10Raw]);
  const new24Raw = useMemo(() => {
    if (Array.isArray(new24h?.items)) return new24h.items;
    if (Array.isArray(new24h)) return new24h;
    return [];
  }, [new24h]);

  const recentRaw = useMemo(() => {
    if (Array.isArray(recent48to72?.items)) return recent48to72.items;
    if (Array.isArray(recent48to72)) return recent48to72;
    return [];
  }, [recent48to72]);

  const filterByContact = (list, filter) => {
    if (filter === 'contacted') return list.filter((item) => item.contacted);
    if (filter === 'uncontacted') return list.filter((item) => !item.contacted);
    return list;
  };

  const newSummary = new24h?.summary || { total: new24Raw.length, contacted: 0, uncontacted: new24Raw.length };
  const recentSummary = recent48to72?.summary || { totalCount: recentRaw.length, contacted: 0, uncontacted: recentRaw.length };

  const new24List = useMemo(() => filterByContact(new24Raw, newContactFilter), [new24Raw, newContactFilter]);
  const recentList = useMemo(() => filterByContact(recentRaw, recentContactFilter), [recentRaw, recentContactFilter]);

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

  // Build cards for "County Trends (last 7 days)"
  const trendCards = ALL_COUNTIES.map((name) => {
    const pc = perCountyMap.get(name) || {};
    const data = seriesByCounty[name] || [];
    return {
      county: name,
      valueTrend: data,
      new24: Number(pc.counts?.today || 0),
      new48: Number(pc.counts?.yesterday || 0),
      new72: Number(pc.counts?.twoDaysAgo || 0),
      bondToday: Number(pc.bondToday || 0),
    };
  });

  // KPIs (as provided by /kpis)
  const kpis = kpiData
    ? {
        new24: kpiData.newCountsBooked?.today ?? 0,
        new48: kpiData.newCountsBooked?.yesterday ?? 0,
        new72: kpiData.newCountsBooked?.twoDaysAgo ?? 0,
        contacted24: kpiData.contacted24h ?? { contacted: 0, total: 0, rate: 0 },
      }
    : { new24: 0, new48: 0, new72: 0, contacted24: { contacted: 0, total: 0, rate: 0 } };

  const loading =
    kpisLoading || topLoading || perCountyLoading || trendsLoading || new24Loading || recentLoading;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-10 bg-white border-b">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <span className="font-semibold tracking-tight">Bail Bonds Dashboard</span>
            <span className="text-xs text-slate-500 hidden sm:block">v0.1</span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <div className="animate-pulse grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-white rounded-2xl border shadow-sm" />
            ))}
          </div>
          <div className="animate-pulse grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="h-48 bg-white rounded-2xl border shadow-sm lg:col-span-2" />
            <div className="h-48 bg-white rounded-2xl border shadow-sm" />
          </div>
          <div className="animate-pulse grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 bg-white rounded-2xl border shadow-sm" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  // Compute county bond value **for selected window** with priority:
  // per-county 'today' → live 24h map → trends series
  const bondValueForWindow = (county) => {
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
    if (trendIndex == null || trendIndex < 0 || trendIndex >= arr.length) return 0;
    const v = Number(arr[trendIndex] || 0);
    return Number.isFinite(v) ? v : 0;
  };

  // County ticker component
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

  // For stacked bar scaling
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-tight">Bail Bonds Dashboard</span>
          <span className="text-xs text-slate-500 hidden sm:block">v0.1</span>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="New (24h)" value={kpis.new24} to="/cases?window=24h" />
          <KpiCard label="New (48h)" value={kpis.new48} to="/cases?window=48h" />
          <KpiCard label="New (72h)" value={kpis.new72} to="/cases?window=72h" />
          <KpiCard
            label="Contacted (24h)"
            value={`${kpis.contacted24.contacted}/${kpis.contacted24.total}`}
            sublabel={`${Math.round((kpis.contacted24.rate || 0) * 100)}%`}
            tone="success"
            to="/cases?window=24h&contacted=true"
          />
        </div>

        {/* Value & County panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Top by value with window switcher */}
          <Panel
            className="lg:col-span-2"
            title={`Top 10 by Value (${valueWindow})`}
            subtitle={`Highest bond amount in selected window${topFallbackNotice ? ` • showing ${topWindowUsed}` : ''}`}
            to={`/cases?window=${valueWindow}&sort=value:desc`}
            right={<WindowSwitcher value={valueWindow} onChange={setValueWindow} />}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <button
                type="button"
                onClick={() => setTopContactFilter('all')}
                className={`rounded-full border px-2 py-1 ${topContactFilter === 'all' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setTopContactFilter('uncontacted')}
                className={`rounded-full border px-2 py-1 ${topContactFilter === 'uncontacted' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                Uncontacted
              </button>
              <button
                type="button"
                onClick={() => setTopContactFilter('contacted')}
                className={`rounded-full border px-2 py-1 ${topContactFilter === 'contacted' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                Contacted
              </button>
              <span className="ml-auto text-slate-400">
                Showing {top10List.length} of {top10Counts.total} • {top10Counts.uncontacted} uncontacted
                {topFallbackNotice ? ' (24h empty)' : ''}
              </span>
            </div>
            {top10List.length ? (
              <ul className="divide-y text-sm">
                {top10List.map((x) => (
                  <li key={x.id} className="py-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-800">{x.name}</div>
                      <div className="text-slate-500 text-xs">
                        {prettyCounty(x.county)} • Booked {x.booking_date || x.bookedAt || ''}
                      </div>
                      {(x.offense || x.agency || x.facility) ? (
                        <div className="text-[11px] text-slate-500 truncate max-w-[48ch]">
                          {x.offense ? <span className="mr-2">{x.offense}</span> : null}
                          {x.agency || x.facility ? (
                            <span className="inline-block">• {(x.agency || x.facility)}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {(x.sex || x.race) ? (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {x.sex ? (
                            <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5">
                              {x.sex}
                            </span>
                          ) : null}
                          {x.race ? (
                            <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5">
                              {x.race}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right">
                      {x.category ? (
                        <div className="text-[10px] text-slate-500 mb-0.5">{x.category}</div>
                      ) : null}
                      <div className="mb-1 text-[11px] text-slate-500">
                        {x.contacted ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Contacted</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">Uncontacted</span>
                        )}
                        {x.last_contact_at ? (
                          <span className="ml-2 text-slate-400">Last: {new Date(x.last_contact_at).toLocaleDateString()}</span>
                        ) : null}
                      </div>
                      <div className="font-semibold">
                        <BondDisplay amount={x.value || x.bond_amount} status={x.bond_status} raw={x.bond_raw || x.bond} />
                      </div>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => navigate(`/cases/${x.id}`)}
                          className="text-xs inline-flex items-center rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-700"
                        >
                          Open case
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-500">No results for this window.</div>
            )}
          </Panel>

          {/* County Bond Value (by selected window) derived from priority chain */}
          <Panel
            title={`County Bond Value (${valueWindow})`}
            subtitle="Sum of bond amounts for new bookings in the selected window (24h prefers per-county today, then live feed)"
            right={<WindowSwitcher value={valueWindow} onChange={setValueWindow} />}
          >
            <div className="grid grid-cols-2 gap-3">
              {ALL_COUNTIES.map((name) => {
                const amount = bondValueForWindow(name);
                return (
                  <div key={name} className="rounded-xl border p-3">
                    <div className="text-sm font-semibold text-slate-800">{prettyCounty(name)}</div>
                    <div className="text-slate-500 text-xs">{money(amount)}</div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* County trends */}
        <Panel title="County Trends (last 7 days)" subtitle="New vs aging volume and bond value">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {trendCards.map((c) => (
              <div key={c.county} className="rounded-2xl border p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-800">{prettyCounty(c.county)}</div>
                  <div className="text-xs text-slate-500">Today: {money(c.bondToday)}</div>
                </div>
                <div className="mt-3">
                  <MiniStackedBar
                    new24={c.new24 || 0}
                    new48={c.new48 || 0}
                    new72={c.new72 || 0}
                  />
                </div>
                <div className="mt-3 text-[10px] text-slate-500 flex items-center gap-3">
                  <span className="inline-block w-3 h-3 bg-green-400 rounded-sm" /> 24h
                  <span className="inline-block w-3 h-3 bg-amber-400 rounded-sm" /> 48h
                  <span className="inline-block w-3 h-3 bg-red-400 rounded-sm" /> 72h
                </div>
                <div className="mt-3 text-xs text-slate-500">Bond value (7d)</div>
                <Sparkline values={Array.isArray(c.valueTrend) ? c.valueTrend : []} />
              </div>
            ))}
          </div>
        </Panel>

        {/* New (24h) */}
          <Panel title="New Inmates (24h)" subtitle="Most recent bookings with contact status" to="/cases?window=24h">
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setNewContactFilter('all')}
                className={`rounded-full border px-2 py-1 ${newContactFilter === 'all' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setNewContactFilter('uncontacted')}
                className={`rounded-full border px-2 py-1 ${newContactFilter === 'uncontacted' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                Uncontacted
              </button>
              <button
                type="button"
                onClick={() => setNewContactFilter('contacted')}
                className={`rounded-full border px-2 py-1 ${newContactFilter === 'contacted' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                Contacted
              </button>
              <span className="ml-auto text-slate-400">
                Showing {new24List.length} of {newSummary.total} • {newSummary.uncontacted} uncontacted
              </span>
            </div>
          <CountyTicker map={new24ByCounty} windowLabel="24h" />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-500">
                <tr className="border-b">
                  <th className="py-2 pr-4 text-left font-semibold">Person</th>
                  <th className="py-2 pr-4 text-left font-semibold">County</th>
                  <th className="py-2 pr-4 text-left font-semibold">Booked</th>
                  <th className="py-2 pr-4 text-left font-semibold">Bond</th>
                  <th className="py-2 pr-4 text-left font-semibold">Offense</th>
                  <th className="py-2 pr-4 text-left font-semibold">Agency / Facility</th>
                  <th className="py-2 text-left font-semibold">Contacted</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {new24List
                  .slice()
                  .sort(
                    (a, b) =>
                      (Number(b.bond_amount ?? 0) || 0) -
                      (Number(a.bond_amount ?? 0) || 0)
                  )
                  .slice(0, 10)
                  .map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 pr-4 font-medium text-slate-800">
                        <Link to={`/cases/${row.id}`} className="text-blue-600 hover:text-blue-700">
                          {row.person}
                        </Link>
                        {(row.sex || row.race) ? (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {row.sex ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5">
                                {row.sex}
                              </span>
                            ) : null}
                            {row.race ? (
                              <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5">
                                {row.race}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-slate-700">{prettyCounty(row.county)}</td>
                      <td className="py-2 pr-4 text-slate-700">{row.booking_date || row.bookedAt || ''}</td>
                      <td className="py-2 pr-4 text-slate-700">
                        <BondDisplay amount={row.bond_amount} status={row.bond_status} raw={row.bond_raw || row.bond} />
                      </td>
                      <td className="py-2 pr-4 text-slate-700 truncate max-w-[36ch]">{row.offense || ''}</td>
                      <td className="py-2 pr-4 text-slate-700 truncate max-w-[28ch]">
                        {row.agency || row.facility || ''}
                      </td>
                      <td className="py-2">
                        {row.contacted ? (
                          <span className="inline-flex items-center rounded-md bg-green-50 text-green-700 text-xs px-2 py-1">
                            Yes
                          </span>
                        ) : (
                          <button
                            onClick={() => navigate(`/messages?compose=initial&case=${row.id}`)}
                            className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"
                          >
                            Send outreach
                          </button>
                        )}
                        {row.last_contact_at ? (
                          <div className="mt-1 text-[10px] text-slate-400">Last contact {new Date(row.last_contact_at).toLocaleDateString()}</div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                {new24List.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      No bookings in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Recent (48–72h) */}
          <Panel title="Recent Inmates (48–72h)" subtitle="Focus on uncontacted & high value" to="/cases?window=48-72h">
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setRecentContactFilter('all')}
                className={`rounded-full border px-2 py-1 ${recentContactFilter === 'all' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setRecentContactFilter('uncontacted')}
                className={`rounded-full border px-2 py-1 ${recentContactFilter === 'uncontacted' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                Uncontacted
              </button>
              <button
                type="button"
                onClick={() => setRecentContactFilter('contacted')}
                className={`rounded-full border px-2 py-1 ${recentContactFilter === 'contacted' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}
              >
                Contacted
              </button>
              <span className="ml-auto text-slate-400">
                Showing {recentList.length} of {recentSummary.totalCount ?? recentRaw.length} • {recentSummary.uncontacted ?? (recentRaw.length - (recentSummary.contacted || 0))} uncontacted
              </span>
            </div>
          <CountyTicker map={recentByCounty} windowLabel="48-72h" />
          {(() => {
            const list = Array.isArray(recentList) ? recentList : [];
            const withValue = list.map((r) => ({
              ...r,
              _bondValue: Number(r.bond_amount ?? 0) || 0,
              _bookedDate: r.booking_date || r.bookedAt || null,
            }));

            const now = new Date();
            const hoursFromNow = (dStr) => {
              if (!dStr) return Infinity;
              const d = /^\d{4}-\d{2}-\d{2}$/.test(dStr) ? new Date(dStr + 'T00:00:00Z') : new Date(dStr);
              return (now - d) / (1000 * 60 * 60);
            };

            const in48 = withValue.filter((r) => {
              const h = hoursFromNow(r._bookedDate);
              return h >= 24 && h < 48;
            }).length;

            const in72 = withValue.filter((r) => {
              const h = hoursFromNow(r._bookedDate);
              return h >= 48 && h <= 72;
            }).length;

            const total = withValue.length;

            const top10 = withValue
              .slice()
              .sort((a, b) => b._bondValue - a._bondValue)
              .slice(0, 10);

            return (
              <>
                <div className="mb-3 text-xs text-slate-600">
                  <span className="mr-3">
                    Total: <span className="font-semibold">{total}</span>
                  </span>
                  <span className="mr-3">
                    48h: <span className="font-semibold">{in48}</span>
                  </span>
                  <span>
                    72h: <span className="font-semibold">{in72}</span>
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-slate-500">
                      <tr className="border-b">
                        <th className="py-2 pr-4 text-left font-semibold">Person</th>
                        <th className="py-2 pr-4 text-left font-semibold">County</th>
                        <th className="py-2 pr-4 text-left font-semibold">Booked</th>
                        <th className="py-2 pr-4 text-left font-semibold">Bond</th>
                        <th className="py-2 pr-4 text-left font-semibold">Offense</th>
                        <th className="py-2 text-left font-semibold">Contacted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {top10.map((row) => (
                        <tr key={row.id}>
                          <td className="py-2 pr-4 font-medium text-slate-800">
                            <Link to={`/cases/${row.id}`} className="text-blue-600 hover:text-blue-700">
                              {row.person}
                            </Link>
                            {(row.sex || row.race) ? (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {row.sex ? (
                                  <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5">
                                    {row.sex}
                                  </span>
                                ) : null}
                                {row.race ? (
                                  <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5">
                                    {row.race}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 pr-4 text-slate-700">{prettyCounty(row.county)}</td>
                          <td className="py-2 pr-4 text-slate-700">{row._bookedDate ? String(row._bookedDate) : ''}</td>
                          <td className="py-2 pr-4 text-slate-700">
                            <BondDisplay
                              amount={row.bond_amount ?? row._bondValue}
                              status={row.bond_status}
                              raw={row.bond_raw || row.bond}
                            />
                          </td>
                          <td className="py-2 pr-4 text-slate-700 truncate max-w-[36ch]">{row.offense || ''}</td>
                      <td className="py-2">
                        {row.contacted ? (
                          <span className="inline-flex items-center rounded-md bg-green-50 text-green-700 text-xs px-2 py-1">
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-amber-50 text-amber-700 text-xs px-2 py-1">
                            No
                          </span>
                        )}
                        {row.last_contact_at ? (
                          <div className="mt-1 text-[10px] text-slate-400">Last contact {new Date(row.last_contact_at).toLocaleDateString()}</div>
                        ) : null}
                      </td>
                    </tr>
                      ))}
                      {top10.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-slate-500">
                            No results in the 48–72h window.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </Panel>

        {/* Counties Overview */}
        <Panel title="Counties Overview" subtitle="Pull status and daily value by county" to="/cases">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ALL_COUNTIES.map((name) => {
              const c = perCountyMap.get(name) || {};
              return (
                <CountyCard
                  key={name}
                  county={name}
                  label={prettyCounty(name)}
                  lastPull={(kpiData?.perCountyLastPull || []).find((x) => normCountyKey(x.county) === name)?.lastPull || '—'}
                  new24={c.counts?.today || 0}
                  new48={c.counts?.yesterday || 0}
                  new72={c.counts?.twoDaysAgo || 0}
                  contacted24={0}
                  bondValue={bondValueForWindow(name)}
                />
              );
            })}
          </div>
        </Panel>
      </main>
    </div>
  );
}
