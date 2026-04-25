import { Fragment } from 'react';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function SummaryStat({ label, value, hint, tone = 'default' }) {
  const toneClasses = {
    default: 'border-slate-200',
    info: 'border-blue-200',
    success: 'border-emerald-200',
    warn: 'border-amber-200',
    danger: 'border-rose-200',
  };
  return (
    <div className={`rounded-2xl border ${toneClasses[tone] || toneClasses.default} bg-white p-4 shadow-sm`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function SectionCard({ title, subtitle, action, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {(title || subtitle || action) ? (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title ? <h2 className="text-base font-semibold text-slate-900">{title}</h2> : null}
            {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
          </div>
          {action ? <div className="flex items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function FilterPills({ items = [], onClear }) {
  if (!items.length && !onClear) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm text-slate-600">
      {items.map((item, idx) => (
        <Fragment key={idx}>
          {idx > 0 ? <span className="opacity-50">•</span> : null}
          <span>{item}</span>
        </Fragment>
      ))}
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

export function DataTable({ columns = [], rows = [], empty, renderActions, onRowClick }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3">{col.header}</th>
            ))}
            {renderActions ? <th className="px-4 py-3" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white text-sm text-slate-700">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (renderActions ? 1 : 0)} className="px-4 py-8 text-center text-slate-400">
                {empty || 'No records yet.'}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id || row.key}
                className={`hover:bg-slate-50 ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 align-top">
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
                {renderActions ? (
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => {
                      // Prevent row-level navigation when interacting with actions
                      e.stopPropagation();
                    }}
                  >
                    {renderActions(row)}
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PageToolbar({ children }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
      {children}
    </div>
  );
}
