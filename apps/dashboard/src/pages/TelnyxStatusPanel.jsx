import { SectionCard } from '../components/PageToolkit';
import { useTelnyxStatus } from '../hooks/telnyxStatus';

function ConfigBadge({ ok, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {ok ? '✓' : '—'} {label}
    </span>
  );
}

function formatPercent(rate) {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

export default function TelnyxStatusPanel() {
  const { data, isLoading, isFetching, error, refetch } = useTelnyxStatus();

  const configured = data?.configured;
  const isConfigured = Boolean(configured?.api_key && (configured?.sender_number || configured?.messaging_profile_id));
  const recent = data?.recent_24h;
  const lastSend = data?.last_send;

  return (
    <SectionCard
      title="Integrations"
      subtitle="External system connections"
      action={(
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-400 disabled:opacity-60"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    >
      {isLoading ? (
        <p className="py-4 text-sm text-slate-500">Loading Telnyx status…</p>
      ) : error ? (
        <p className="py-4 text-sm text-rose-600">Failed to load Telnyx status: {error.message}</p>
      ) : (
        <div className="space-y-3 py-2">
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              isConfigured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            <span>{isConfigured ? '✅' : '⚠'}</span>
            <span>
              {isConfigured
                ? 'Telnyx messaging is configured.'
                : 'Telnyx messaging is not fully configured — set TELNYX_API_KEY and a sender number or messaging profile.'}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <ConfigBadge ok={configured?.api_key} label="API key" />
            <ConfigBadge ok={configured?.sender_number} label="Sender number" />
            <ConfigBadge ok={configured?.messaging_profile_id} label="Messaging profile" />
            <ConfigBadge ok={configured?.webhook_public_key} label="Webhook signature key" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Sent (24h)</div>
              <div className="font-medium text-slate-800">{recent?.total ?? 0}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Failed (24h)</div>
              <div className="font-medium text-slate-800">{recent?.failed ?? 0}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Success rate</div>
              <div className="font-medium text-slate-800">{formatPercent(recent?.success_rate)}</div>
            </div>
          </div>

          <div className="text-xs text-slate-500">
            {lastSend
              ? `Last send: ${lastSend.status} at ${new Date(lastSend.createdAt).toLocaleString()}`
              : 'No messages sent yet.'}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
