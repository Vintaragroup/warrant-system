import { useMemo, useState } from 'react';
import { PageHeader, PageToolbar, SectionCard, SummaryStat, DataTable } from '../components/PageToolkit';

const MOCK_EVENTS = [
  { id: 'EV-01', defendant: 'Alicia Ramirez', county: 'harris', start: '2025-02-20 09:00', courtroom: 'Crim Ct 5', type: 'Arraignment', reminderSent: true },
  { id: 'EV-02', defendant: 'Jeff Martin', county: 'galveston', start: '2025-02-21 13:30', courtroom: '213', type: 'Bond Hearing', reminderSent: false },
  { id: 'EV-03', defendant: 'Imani Woods', county: 'fortbend', start: '2025-02-27 08:45', courtroom: 'Docket 7', type: 'Status', reminderSent: true },
  { id: 'EV-04', defendant: 'Cory Nguyen', county: 'harris', start: '2025-03-03 10:15', courtroom: 'Crim Ct 2', type: 'Pre-trial', reminderSent: false },
];

const RANGES = [
  { id: '7', label: 'Next 7 days' },
  { id: '30', label: 'Next 30 days' },
];

export default function Calendar() {
  const [range, setRange] = useState('7');
  const [view, setView] = useState('list');

  const filteredEvents = useMemo(() => {
    const days = Number(range);
    if (!Number.isFinite(days)) return MOCK_EVENTS;
    const now = Date.now();
    const windowMs = days * 24 * 60 * 60 * 1000;
    return MOCK_EVENTS.filter((event) => {
      const eventDate = new Date(event.start.replace(' ', 'T'));
      if (Number.isNaN(eventDate.getTime())) return true;
      const diff = eventDate.getTime() - now;
      return diff >= 0 && diff <= windowMs;
    });
  }, [range]);

  const remindersPending = filteredEvents.filter((event) => !event.reminderSent).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Court Calendar"
        subtitle="Track upcoming appearances and coordinate reminders."
        actions={(
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
            >
              Add event
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400"
            >
              Sync with Outlook
            </button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStat label="Events tracked" value={filteredEvents.length} tone="info" />
        <SummaryStat label="Reminders pending" value={remindersPending} tone="warn" />
        <SummaryStat label="Reminders sent" value={filteredEvents.length - remindersPending} tone="success" />
      </div>

      <PageToolbar>
        <div className="flex flex-wrap gap-2">
          {RANGES.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRange(opt.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                range === opt.id ? 'bg-blue-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('list')}
            className={`rounded-lg px-3 py-1.5 text-sm ${view === 'list' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={`rounded-lg px-3 py-1.5 text-sm ${view === 'calendar' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            Calendar
          </button>
        </div>
      </PageToolbar>

      {view === 'list' ? (
        <SectionCard title="Upcoming events" subtitle="Stay ahead of appearances and magistration dates">
          <DataTable
            columns={[
              { key: 'start', header: 'Date & time' },
              { key: 'defendant', header: 'Defendant' },
              { key: 'county', header: 'County', render: (value) => value.charAt(0).toUpperCase() + value.slice(1) },
              { key: 'courtroom', header: 'Courtroom' },
              { key: 'type', header: 'Hearing type' },
              {
                key: 'reminderSent',
                header: 'Reminder',
                render: (value) => (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${value ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {value ? 'Sent' : 'Pending'}
                  </span>
                ),
              },
            ]}
            rows={filteredEvents}
            renderActions={() => (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600"
                >
                  View case
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                >
                  Send reminder
                </button>
              </div>
            )}
          />
        </SectionCard>
      ) : (
        <SectionCard title="Calendar view" subtitle="Monthly heat-map placeholder">
          <div className="grid grid-cols-7 gap-2 text-center text-sm text-slate-600">
            {Array.from({ length: 28 }, (_, idx) => idx + 1).map((day) => {
              const hasEvent = filteredEvents.some((event) => event.start.slice(8, 10) === String(day).padStart(2, '0'));
              return (
                <div
                  key={day}
                  className={`rounded-lg border p-3 ${hasEvent ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white'}`}
                >
                  <div className="text-xs">Feb</div>
                  <div className="text-lg font-semibold">{day}</div>
                  {hasEvent ? <div className="mt-1 text-[10px] font-medium">Event</div> : null}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
