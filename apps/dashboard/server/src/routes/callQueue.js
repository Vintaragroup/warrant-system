/* eslint-env node */
import { Router } from 'express';

const r = Router();

// Lightweight in-memory queue to support the Call Queue UI in dev/demo.
// In production, replace with a persistent data source.
const queue = [
  {
    id: 'cq-1',
    status: 'pending',
    caller: { name: 'Alex Carter', phone: '+1 (832) 555-1100' },
    inmate: { full_name: 'Jordan Banks', dob: '1991-04-02' },
    county: 'Harris',
    topic: 'Payment plan',
    urgency: 'high',
    requested_at: Date.now(),
    notes: 'Wants to set up recurring payments.',
  },
  {
    id: 'cq-2',
    status: 'calling',
    caller: { name: 'Samantha Lee', phone: '+1 (281) 555-4477' },
    inmate: { full_name: 'Marcus Lee', dob: '1989-08-17' },
    county: 'Fort Bend',
    topic: 'Court reminder',
    urgency: 'medium',
    requested_at: Date.now() - 5 * 60 * 1000,
    notes: 'Needs next court date and payment status.',
  },
  {
    id: 'cq-3',
    status: 'completed',
    caller: { name: 'Juan Torres', phone: '+1 (713) 555-8833' },
    inmate: { full_name: 'Luis Torres', dob: '1995-11-30' },
    county: 'Galveston',
    topic: 'Intake questions',
    urgency: 'low',
    requested_at: Date.now() - 45 * 60 * 1000,
    notes: 'Completed. Sent follow-up SMS with documents link.',
    completed_at: Date.now() - 40 * 60 * 1000,
  },
];

let activity = [
  {
    id: 'act-1',
    type: 'call.completed',
    status: 'completed',
    queue_entry_id: 'cq-3',
    notes: 'Call finished; sent docs link via SMS.',
    ts: Date.now() - 38 * 60 * 1000,
  },
  {
    id: 'act-2',
    type: 'call.progress',
    status: 'calling',
    queue_entry_id: 'cq-2',
    notes: 'Agent picked up Samantha.',
    ts: Date.now() - 4 * 60 * 1000,
  },
];

function pushActivity(entry) {
  activity = [{ ...entry, id: entry.id || `act-${Date.now()}` }, ...activity].slice(0, 100);
}

r.get('/', (req, res) => {
  const { status, limit } = req.query;
  const lim = Math.min(Number(limit) || 100, 500);
  const filtered = status ? queue.filter((q) => q.status === status) : queue;
  res.json({ ok: true, items: filtered.slice(0, lim) });
});

r.get('/activity', (req, res) => {
  const { limit } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  res.json({ ok: true, items: activity.slice(0, lim) });
});

r.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body || {};
  const idx = queue.findIndex((q) => q.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  if (status) queue[idx].status = status;
  if (notes !== undefined) queue[idx].notes = notes;
  if (status === 'completed') queue[idx].completed_at = Date.now();
  pushActivity({
    id: `act-${Date.now()}`,
    type: 'call.update',
    status: status || queue[idx].status,
    queue_entry_id: id,
    notes: notes || null,
    ts: Date.now(),
  });
  return res.json({ ok: true, item: queue[idx] });
});

r.post('/notify', (_req, res) => {
  pushActivity({ id: `act-${Date.now()}`, type: 'notification.sent', status: 'sent', ts: Date.now(), notes: 'On-call agents notified.' });
  res.json({ ok: true, message: 'Agents notified' });
});

export default r;
