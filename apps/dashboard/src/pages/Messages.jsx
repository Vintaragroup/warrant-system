import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMessages, useSendMessage } from '../hooks/messages.js';
import { PageHeader, PageToolbar, SectionCard, DataTable, FilterPills } from '../components/PageToolkit';

const FILTERS = {
  direction: [
    { id: 'all', label: 'All' },
    { id: 'out', label: 'Outbox' },
    { id: 'in', label: 'Inbox' },
  ],
  channel: [
    { id: 'all', label: 'All channels' },
    { id: 'sms', label: 'SMS' },
    { id: 'voice', label: 'Voice' },
  ],
  status: [
    { id: 'all', label: 'Any status' },
    { id: 'queued', label: 'Queued' },
    { id: 'sending', label: 'Sending' },
    { id: 'sent', label: 'Sent' },
    { id: 'delivered', label: 'Delivered' },
    { id: 'failed', label: 'Failed' },
  ],
};

const MOCK_TEMPLATES = [
  { id: 'TPL-01', name: 'Court Reminder', channel: 'sms', body: 'Reminder: ${name}, be at ${location} on ${date} at ${time}.' },
  { id: 'TPL-02', name: 'Payment Due', channel: 'sms', body: 'Hi ${name}, your payment of ${amount} is due on ${date}.' },
  { id: 'TPL-03', name: 'Missed Check-in', channel: 'sms', body: 'Hi ${name}, we missed you at today\'s check-in. Reply or call us.' },
];

function normalizeUsE164(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return '+1';
  const withoutCountry = digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${withoutCountry}`;
}

function statusBadgeClass(status) {
  switch (status) {
    case 'failed':
      return 'bg-rose-50 text-rose-700';
    case 'queued':
    case 'sending':
      return 'bg-amber-50 text-amber-700';
    case 'delivered':
      return 'bg-emerald-50 text-emerald-700';
    case 'sent':
      return 'bg-blue-50 text-blue-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export default function Messages() {
  const [searchParams] = useSearchParams();
  const initialCaseIdParam = searchParams.get('caseId') || '';
  const initialToParam = searchParams.get('to') || '';
  const initialBodyParam = searchParams.get('body') || '';

  const [direction, setDirection] = useState('all');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState('all');
  const [caseIdFilter, setCaseIdFilter] = useState(initialCaseIdParam);
  const [showComposer, setShowComposer] = useState(Boolean(initialCaseIdParam || initialToParam || initialBodyParam));
  const [composeCaseId, setComposeCaseId] = useState(initialCaseIdParam || '');
  const [composeTo, setComposeTo] = useState(normalizeUsE164(initialToParam));
  const [composeBody, setComposeBody] = useState(initialBodyParam || '');

  const { data: apiMessages = [], isLoading, isFetching } = useMessages({
    caseId: caseIdFilter || undefined,
    limit: 100,
  });
  const sendMessage = useSendMessage();

  useEffect(() => {
    if (initialCaseIdParam) {
      setCaseIdFilter(initialCaseIdParam);
      setComposeCaseId(initialCaseIdParam);
    }
    if (initialToParam) {
      setComposeTo(normalizeUsE164(initialToParam));
    }
    if (initialBodyParam) {
      setComposeBody(initialBodyParam);
    }
    if (initialCaseIdParam || initialToParam || initialBodyParam) {
      setShowComposer(true);
    }
    // we only want to run this effect once on mount with the initial query snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredMessages = useMemo(() => {
    return apiMessages.filter((msg) => {
      const matchesDirection = direction === 'all' || msg.direction === direction;
      const matchesChannel = channel === 'all' || msg.channel === channel;
      const matchesStatus = status === 'all' || msg.status === status;
      return matchesDirection && matchesChannel && matchesStatus;
    });
  }, [apiMessages, channel, direction, status]);

  const activeFilters = [
    direction !== 'all' ? `Direction: ${direction}` : null,
    channel !== 'all' ? `Channel: ${channel}` : null,
    status !== 'all' ? `Status: ${status}` : null,
    caseIdFilter ? `Case: ${caseIdFilter}` : null,
  ].filter(Boolean);

  const resetFilters = () => {
    setDirection('all');
    setChannel('all');
    setStatus('all');
    setCaseIdFilter('');
  };

  const handleComposeSubmit = (event) => {
    event.preventDefault();
    if (!composeCaseId || !composeBody.trim() || composeTo === '+1') return;
    sendMessage.mutate(
      {
        caseId: composeCaseId,
        to: composeTo,
        body: composeBody,
      },
      {
        onSuccess: () => {
          setShowComposer(false);
          setComposeBody('');
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        subtitle="Search the communications log and work with reusable templates."
        actions={(
          <button
            type="button"
            onClick={() => setShowComposer((prev) => !prev)}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
          >
            {showComposer ? 'Close composer' : 'Compose message'}
          </button>
        )}
      />

      <PageToolbar>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Direction</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {FILTERS.direction.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Channel</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {FILTERS.channel.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {FILTERS.status.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Case</span>
            <input
              type="text"
              value={caseIdFilter}
              onChange={(e) => setCaseIdFilter(e.target.value.trim())}
              placeholder="Case ID"
              className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        <button type="button" className="text-sm text-slate-500 hover:text-slate-700" onClick={resetFilters}>
          Clear filters
        </button>
      </PageToolbar>

      <FilterPills items={activeFilters} onClear={activeFilters.length ? resetFilters : undefined} />

      {showComposer ? (
        <SectionCard title="Compose" subtitle="Send a quick outbound SMS">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleComposeSubmit}>
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-slate-500">Case ID</span>
              <input
                type="text"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={composeCaseId}
                onChange={(e) => setComposeCaseId(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-slate-500">Recipient (E.164)</span>
              <input
                type="tel"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={composeTo}
                onChange={(e) => setComposeTo(normalizeUsE164(e.target.value))}
                placeholder="+15551234567"
                required
              />
            </label>
            <label className="flex flex-col text-sm md:col-span-2">
              <span className="mb-1 text-slate-500">Message</span>
              <textarea
                className="min-h-[120px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                maxLength={1600}
                required
              />
            </label>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowComposer(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sendMessage.isLoading}
                className="rounded-lg border border-blue-600 bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {sendMessage.isLoading ? 'Sending…' : 'Send SMS'}
              </button>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Activity"
        subtitle={isLoading ? 'Loading…' : `${filteredMessages.length} message${filteredMessages.length === 1 ? '' : 's'} found`}
      >
        <DataTable
          empty={(isLoading || isFetching) ? "Loading…" : undefined}
          columns={[
            { key: 'createdAt', header: 'Timestamp', render: (value) => new Date(value).toLocaleString() },
            { key: 'direction', header: 'Dir', render: (value) => value?.toUpperCase?.() },
            { key: 'channel', header: 'Channel', render: (value) => value?.toUpperCase?.() },
            { key: 'person', header: 'Person', render: (_value, row) => row.person || row.caseId || '—' },
            { key: 'caseId', header: 'Case' },
            {
              key: 'body',
              header: 'Preview',
              render: (value) => <span className="max-w-sm truncate text-slate-600">{value}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (value) => (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(value)}`}>
                  {value}
                </span>
              ),
            },
          ]}
          rows={filteredMessages.map((msg, index) => ({
            ...msg,
            id: msg.id || msg._id || msg.providerMessageId || `${msg.caseId || 'row'}-${index}`,
            createdAt: msg.createdAt || msg.sentAt || msg.deliveredAt,
            caseId: msg.caseId || msg.meta?.caseId || '—',
          }))}
          renderActions={(row) => (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600"
              >
                View thread
              </button>
              {row.direction === 'out' && row.status === 'failed' ? (
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}
        />
      </SectionCard>

      <SectionCard title="Templates" subtitle="Quickly reuse messaging patterns">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {MOCK_TEMPLATES.map((tpl) => (
            <article key={tpl.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">{tpl.name}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{tpl.channel.toUpperCase()}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{tpl.body}</p>
              <div className="mt-3 flex gap-2 text-xs">
                <button className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-600" type="button">
                  Use template
                </button>
                <button className="rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:border-slate-300" type="button">
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
