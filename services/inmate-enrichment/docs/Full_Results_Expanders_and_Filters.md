# Full Results — Row Expanders & Filters (UI spec + reference code)

This document describes the Dashboard changes for the Enrichment → Full results view.
It targets the `CaseDetail.jsx` page in the Dashboard repo.

Note: The dashboard code for `CaseDetail.jsx` is not in this workspace. Apply the changes in the dashboard project and deploy.

## Goals

- Add per-row expander to show richer person fields:
  - DOB/age, gender, emails, phones, relations, provider metadata, and a tiny raw JSON snippet
- Add interactive filters:
  - All | High-quality (>= threshold) | With phone
  - Persist selection to the URL: `?tab=enrichment&view=full&filter=high|phone|all`
- Respect the environment threshold (`VITE_HIGH_QUALITY_MATCH`), default 0.75

## URL Contract

- `tab=enrichment` (existing)
- `view=full` (existing)
- `filter` (new): `all` (default), `high`, `phone`

## Data Contract (assumed from API)

Each result row contains:
- `score`: number | null (normalized 0–1; null means not scored yet)
- `name`: string (best-known display name)
- `dob` | `age` | `gender`: optional strings/numbers
- `emails`: string[]
- `phones`: string[] (E.164 preferred)
- `relations`: Array<{ name: string, relation?: string, score?: number | null }>
- `provider`: { name: string, id?: string, cost?: number }
- `raw`: any (provider snippet)

## UI Behavior

- Score column rendering:
  - 0 → "0%"; 0.78 → "78%"; null → "—"
- High-quality row highlight when `score >= threshold`
- Expander caret toggles a details panel beneath the row
- Filters:
  - All: show all rows
  - High-quality: `score >= threshold`
  - With phone: `phones.length > 0`

## Reference React Snippets

Import helpers and env:
```jsx
import { useMemo } from 'react';
const HQ = Number(import.meta.env.VITE_HIGH_QUALITY_MATCH ?? 0.75);

const fmtScore = (s) => (Number.isFinite(s) ? `${Math.round(s * 100)}%` : '—');
```

Filtering and URL sync:
```jsx
import { useSearchParams } from 'react-router-dom';

function useFullFilter() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'all';
  const setFilter = (next) => {
    params.set('filter', next);
    setParams(params, { replace: true });
  };
  return [filter, setFilter];
}

function applyFilter(rows, filter, threshold = HQ) {
  switch (filter) {
    case 'high':
      return rows.filter((r) => Number.isFinite(r.score) && r.score >= threshold);
    case 'phone':
      return rows.filter((r) => Array.isArray(r.phones) && r.phones.length > 0);
    default:
      return rows;
  }
}
```

Row expander state and rendering:
```jsx
import { useState } from 'react';

function Row({ row }) {
  const [open, setOpen] = useState(false);
  const isHQ = Number.isFinite(row.score) && row.score >= HQ;
  return (
    <div className={`result-row ${isHQ ? 'hq' : ''}`}>
      <div className="row-main" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▼' : '▶'}</span>
        <span className="name">{row.name || 'Unknown'}</span>
        <span className="score">{fmtScore(row.score)}</span>
        <span className="phones">{row.phones?.length ?? 0} phones</span>
      </div>
      {open && (
        <div className="row-details">
          <div className="cols">
            <div>
              <div>DOB / Age: {row.dob || (row.age ?? '—')}</div>
              <div>Gender: {row.gender || '—'}</div>
              <div>Emails: {row.emails?.join(', ') || '—'}</div>
              <div>Phones: {row.phones?.join(', ') || '—'}</div>
            </div>
            <div>
              <div>Relations:</div>
              <ul>
                {(row.relations || []).map((rel, i) => (
                  <li key={i}>
                    {rel.name}
                    {rel.relation ? ` (${rel.relation})` : ''}
                    {Number.isFinite(rel.score) ? ` — ${fmtScore(rel.score)}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div>Provider: {row.provider?.name || '—'}</div>
              <div>Cost: {row.provider?.cost ?? '—'}</div>
              <details>
                <summary>Raw snippet</summary>
                <pre>{JSON.stringify(row.raw, null, 2)?.slice(0, 2000)}</pre>
              </details>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Putting it together in the Full view:
```jsx
function FullResults({ rows }) {
  const [filter, setFilter] = useFullFilter();
  const filtered = useMemo(() => applyFilter(rows, filter, HQ), [rows, filter]);

  return (
    <div>
      <div className="toolbar">
        <button className={filter==='all'?'active':''} onClick={() => setFilter('all')}>All</button>
        <button className={filter==='high'?'active':''} onClick={() => setFilter('high')}>High-quality</button>
        <button className={filter==='phone'?'active':''} onClick={() => setFilter('phone')}>With phone</button>
        <span className="threshold">HQ ≥ {Math.round(HQ*100)}%</span>
      </div>
      <div className="results">
        {filtered.map((row) => (
          <Row key={row.id || row.provider?.id || row.name} row={row} />
        ))}
      </div>
    </div>
  );
}
```

## Edge Cases

- score === 0 → display "0%" (not em dash)
- score is null/undefined → display "—"
- rows with missing `phones`/`emails` arrays → treat as empty arrays
- unstable keys: prefer a stable `id`; if not available, fallback to `${provider.id}:${name}`

## Minimal CSS (optional)

```css
.result-row { border-bottom: 1px solid #eee; }
.result-row.hq { background: #f6ffed; }
.row-main { display:flex; gap: 12px; align-items:center; padding: 8px 0; cursor:pointer; }
.row-details { padding: 8px 16px 16px; }
.cols { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.toolbar { display:flex; gap: 8px; align-items:center; margin-bottom: 8px; }
.toolbar .active { font-weight: 600; text-decoration: underline; }
```

## QA Checklist

- Filter toggles update the URL without full page reload
- Reload with `?filter=high` shows only rows with score >= threshold
- Matches with score 0 render as 0% (not —)
- High-quality rows show a subtle highlight
- Expander shows phones, emails, relations, provider, and raw snippet
- Large raw payloads are truncated in the UI
