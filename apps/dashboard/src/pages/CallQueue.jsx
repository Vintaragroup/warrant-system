import { useMemo, useState } from 'react';
import { PageHeader, SectionCard } from '../components/PageToolkit';
import { Button } from '../components/ui/button';
import { StatusChip } from '../components/ui/status-chip';
import { Textarea } from '../components/ui/textarea';
import { useToast } from '../components/ToastContext';
import { useCallQueue, useCallQueueActivity, useNotifyCallQueue, useUpdateCallQueueEntry } from '../hooks/call-queue';

const STATUS_FILTERS = [
  { id: 'pending', label: 'In queue' },
  { id: 'calling', label: 'Calling' },
  { id: 'completed', label: 'Completed' },
];

function formatRelative(value) {
  if (!value) return '—';
  const dt = new Date(value * 1000 || value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString();
}

function StatusBadge({ status }) {
  const map = {
    pending: { tone: 'pending', label: 'Pending' },
    calling: { tone: 'active', label: 'Calling' },
    completed: { tone: 'success', label: 'Completed' },
  };
  const cfg = map[status] || { tone: 'inactive', label: status || 'Unknown' };
  return <StatusChip status={cfg.tone}>{cfg.label}</StatusChip>;
}

export default function CallQueue() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [noteDraft, setNoteDraft] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const toast = useToast();

  const pending = useCallQueue({ status: 'pending' });
  const calling = useCallQueue({ status: 'calling' });
  const completed = useCallQueue({ status: 'completed', limit: 50 });
  const activity = useCallQueueActivity();

  const queue = statusFilter === 'pending' ? pending.data : statusFilter === 'calling' ? calling.data : completed.data;

  const updateEntry = useUpdateCallQueueEntry();
  const notifyAgents = useNotifyCallQueue();

  const summary = useMemo(() => ({
    pending: pending.data?.length || 0,
    calling: calling.data?.length || 0,
    completed: completed.data?.length || 0,
  }), [pending.data, calling.data, completed.data]);

  const recentCalls = useMemo(() => {
    const rows = Array.isArray(completed.data) ? completed.data.slice(0, 10) : [];
    return rows.map((row) => ({
      id: row.id,
      caller: row.caller?.name || 'Unknown',
      phone: row.caller?.phone || '—',
      county: row.county || '—',
      inmate: row.inmate?.full_name || row.inmate?.name || '—',
      topic: row.topic || '—',
      completedAt: row.completed_at || row.completedAt || row.requested_at || row.requestedAt,
      notes: row.notes || '',
    }));
  }, [completed.data]);

  const isMutating = updateEntry.isPending || notifyAgents.isPending;

  const handleStatus = async (row, nextStatus) => {
    try {
      await updateEntry.mutateAsync({ id: row.id, status: nextStatus });
      toast.pushToast({ title: 'Updated', message: `${row.caller?.name || 'Caller'} marked ${nextStatus}`, variant: 'success' });
    } catch (err) {
      toast.pushToast({ title: 'Update failed', message: err.message || String(err), variant: 'error' });
    }
  };

  const handleSaveNote = async () => {
    if (!selectedId) return;
    try {
      await updateEntry.mutateAsync({ id: selectedId, notes: noteDraft });
      toast.pushToast({ title: 'Note saved', message: 'Notes updated for entry.', variant: 'success' });
    } catch (err) {
      toast.pushToast({ title: 'Save failed', message: err.message || String(err), variant: 'error' });
    }
  };

  const handleNotify = async () => {
    try {
      await notifyAgents.mutateAsync({});
      toast.pushToast({ title: 'Agents notified', message: 'Queue summary sent.', variant: 'success' });
    } catch (err) {
      toast.pushToast({ title: 'Notify failed', message: err.message || String(err), variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call Queue"
        subtitle="Monitor callers waiting for agents, update statuses, and notify the on-call team."
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { pending.refetch(); calling.refetch(); completed.refetch(); }} disabled={pending.isFetching || calling.isFetching || completed.isFetching}>
              Refresh
            </Button>
            <Button size="sm" onClick={handleNotify} disabled={isMutating}>
              Notify agents
            </Button>
          </div>
        )}
      />

      <SectionCard>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="In queue" value={summary.pending} />
          <StatTile label="Calling" value={summary.calling} />
          <StatTile label="Completed (recent)" value={summary.completed} />
        </div>
      </SectionCard>

      <SectionCard title="Recent calls" subtitle="Last completed calls with quick context.">
        <div className="space-y-2">
          {recentCalls.length ? recentCalls.map((call) => (
            <div key={call.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-900">
                <span className="font-medium">{call.caller}</span>
                <span className="text-xs text-slate-500">{formatRelative(call.completedAt)}</span>
              </div>
              <div className="text-xs text-slate-600">{call.phone} • {call.county} • {call.topic}</div>
              <div className="text-xs text-slate-600">Inmate: {call.inmate}</div>
              {call.notes ? <div className="text-xs text-slate-500">Notes: {call.notes}</div> : null}
            </div>
          )) : <div className="text-sm text-slate-500">No completed calls yet.</div>}
        </div>
      </SectionCard>

      <SectionCard
        title="Queue"
        subtitle="Filter by status and update caller progress."
        action={(
          <div className="flex gap-2">
            {STATUS_FILTERS.map((s) => (
              <Button
                key={s.id}
                variant={statusFilter === s.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(s.id)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        )}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Caller</th>
                <th className="px-3 py-2 text-left">Inmate</th>
                <th className="px-3 py-2 text-left">County</th>
                <th className="px-3 py-2 text-left">Topic</th>
                <th className="px-3 py-2 text-left">Urgency</th>
                <th className="px-3 py-2 text-left">Requested</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {queue?.length ? queue.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{row.caller?.name || 'Unknown'}</div>
                    <div className="text-xs text-slate-500">{row.caller?.phone || '—'}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-slate-900">{row.inmate?.full_name || row.inmate?.name || '—'}</div>
                    {row.inmate?.dob ? <div className="text-xs text-slate-500">DOB {row.inmate.dob}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.county || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{row.topic || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{String(row.urgency || 'medium')}</td>
                  <td className="px-3 py-2 text-slate-700">{formatRelative(row.requested_at || row.requestedAt)}</td>
                  <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => { setSelectedId(row.id); setNoteDraft(row.notes || ''); }}>
                      Notes
                    </Button>
                    {row.status !== 'calling' && (
                      <Button size="sm" variant="outline" onClick={() => handleStatus(row, 'calling')} disabled={isMutating}>
                        Mark calling
                      </Button>
                    )}
                    {row.status !== 'completed' && (
                      <Button size="sm" onClick={() => handleStatus(row, 'completed')} disabled={isMutating}>
                        Mark completed
                      </Button>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">No entries.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Notes" subtitle="Update the selected entry's notes.">
        <div className="space-y-3">
          <Textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder={selectedId ? 'Add notes for this caller' : 'Select an entry to edit notes'}
            disabled={!selectedId || isMutating}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setNoteDraft(''); setSelectedId(null); }} disabled={isMutating}>
              Clear
            </Button>
            <Button size="sm" onClick={handleSaveNote} disabled={!selectedId || isMutating}>
              Save note
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Recent activity" subtitle="Latest queue and Telnyx events.">
        <div className="space-y-2">
          {activity.data?.length ? activity.data.map((item) => (
            <div key={`${item.id || item.ts}-${item.type}-${item.queue_entry_id || ''}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between text-sm text-slate-900">
                <span>{item.type || 'event'}</span>
                <span className="text-xs text-slate-500">{formatRelative(item.ts)}</span>
              </div>
              {item.status ? <div className="text-xs text-slate-600">Status: {item.status}</div> : null}
              {item.notes ? <div className="text-xs text-slate-600">Notes: {item.notes}</div> : null}
            </div>
          )) : <div className="text-sm text-slate-500">No recent events.</div>}
        </div>
      </SectionCard>
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-900">{Number.isFinite(value) ? value : '—'}</div>
    </div>
  );
}
