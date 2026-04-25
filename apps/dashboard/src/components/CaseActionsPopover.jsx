import { useEffect, useState } from 'react';
import { useCaseMeta, useUpdateCaseStage, useUpdateCaseTags, useUpdateCaseCrm } from '../hooks/cases';
import { useToast } from './ToastContext';
import CrmStageSelect from './CrmStageSelect';

const DEFAULT_TAGS = ['priority', 'needs_attention', 'disregard'];
const FOLLOW_UP_PRESETS = [
  { id: 'today', label: 'Later today', offsetHours: 4 },
  { id: 'tomorrow', label: 'Tomorrow 9am', offsetDays: 1, setHour: 9 },
  { id: 'threeDays', label: 'In 3 days', offsetDays: 3, setHour: 9 },
  { id: 'nextWeek', label: 'Next week', offsetDays: 7, setHour: 9 },
];

function formatLabel(text = '') {
  return text
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CaseActionsPopover({
  caseId,
  stage,
  manualTags = [],
  contactInfo,
  assignedTo,
  followUpAt,
  onRefresh,
  onOpenCase,
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [assignedDraft, setAssignedDraft] = useState(assignedTo || '');
  const [followUpDraft, setFollowUpDraft] = useState('');
  const { data: meta } = useCaseMeta();
  const { pushToast } = useToast();
  const updateStage = useUpdateCaseStage({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Stage updated', message: 'Stage saved successfully.' });
      setOpen(false);
      setNote('');
      onRefresh?.();
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Stage update failed', message: err?.message || 'Unable to update stage.' });
    },
  });
  const updateTags = useUpdateCaseTags({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Tags updated', message: 'Tags saved successfully.' });
      onRefresh?.();
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Tag update failed', message: err?.message || 'Unable to update tags.' });
    },
  });
  const updateCrm = useUpdateCaseCrm({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'CRM updated', message: 'Saved follow-up details.' });
      onRefresh?.();
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Update failed', message: err?.message || 'Unable to update CRM details.' });
    },
  });

  const tagOptions = Array.isArray(meta?.manualTagOptions) && meta.manualTagOptions.length
    ? meta.manualTagOptions
    : DEFAULT_TAGS;

  const stageOptions = Array.isArray(meta?.stages) && meta.stages.length
    ? meta.stages
    : ['new', 'contacted', 'qualifying', 'accepted', 'denied'];

  const isUpdating = updateStage.isPending || updateTags.isPending;
  const crmUpdating = updateCrm.isPending;

  const toggleTag = (tagId) => {
    const isActive = manualTags.includes(tagId);
    const next = isActive
      ? manualTags.filter((tag) => tag !== tagId)
      : [...manualTags, tagId];
    updateTags.mutate({ caseId, tags: next });
  };

  const handleStageChange = (event) => {
    const nextStage = event.target.value;
    updateStage.mutate({ caseId, stage: nextStage, note: note.trim() || undefined });
  };

  useEffect(() => {
    if (!open) return;
    setAssignedDraft(assignedTo || '');
    if (followUpAt) {
      const dt = new Date(followUpAt);
      setFollowUpDraft(Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 16));
    } else {
      setFollowUpDraft('');
    }
  }, [open, assignedTo, followUpAt]);

  const applyFollowUpPreset = (preset) => {
    if (!preset) return;
    const now = new Date();
    if (preset.offsetDays) now.setDate(now.getDate() + preset.offsetDays);
    if (preset.offsetHours) now.setHours(now.getHours() + preset.offsetHours);
    if (typeof preset.setHour === 'number') {
      now.setHours(preset.setHour, 0, 0, 0);
    } else {
      now.setMinutes(0, 0, 0);
    }
    setFollowUpDraft(now.toISOString().slice(0, 16));
  };

  const handleCrmSave = () => {
    if (!caseId) return;
    const payload = { assignedTo: assignedDraft.trim() };
    if (followUpDraft) {
      const dt = new Date(followUpDraft);
      if (Number.isNaN(dt.getTime())) {
        pushToast({ variant: 'warn', title: 'Invalid follow-up', message: 'Choose a valid follow-up time.' });
        return;
      }
      payload.followUpAt = dt.toISOString();
    } else {
      payload.followUpAt = null;
    }
    updateCrm.mutate({ caseId, payload });
  };

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-8 w-8 items-center justify-center text-3xl leading-none text-slate-400 hover:text-slate-600"
        aria-label="Case actions"
      >
        ⋮
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <div className="mb-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stage</div>
            <CrmStageSelect
              value={stage || 'new'}
              onChange={handleStageChange}
              stageOptions={stageOptions}
              disabled={isUpdating}
              className="mt-1"
            />
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add note (optional)"
              className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
              rows={2}
              disabled={isUpdating}
            />
          </div>

          <div className="mb-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Owner & follow-up</div>
            <input
              type="text"
              value={assignedDraft}
              onChange={(e) => setAssignedDraft(e.target.value)}
              placeholder="Assign to…"
              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              disabled={crmUpdating}
            />
            <input
              type="datetime-local"
              value={followUpDraft}
              onChange={(e) => setFollowUpDraft(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              disabled={crmUpdating}
            />
            <div className="flex flex-wrap gap-1 text-[11px] text-slate-600">
              {FOLLOW_UP_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyFollowUpPreset(preset)}
                  className="rounded-full border border-slate-300 px-2 py-0.5 hover:border-blue-300 hover:text-blue-700"
                  disabled={crmUpdating}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFollowUpDraft('')}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500 hover:border-rose-300 hover:text-rose-600"
                disabled={crmUpdating}
              >
                Clear
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCrmSave}
                className="flex-1 rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-sm text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={crmUpdating}
              >
                {crmUpdating ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onOpenCase) onOpenCase();
                  else window.location.assign(`/cases/${caseId}`);
                }}
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                disabled={crmUpdating}
              >
                Open case
              </button>
            </div>
          </div>

          <div className="mb-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual tags</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {tagOptions.map((tagId) => {
                const isActive = manualTags.includes(tagId);
                return (
                  <button
                    key={tagId}
                    type="button"
                    onClick={() => toggleTag(tagId)}
                    disabled={isUpdating}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${isActive ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:border-blue-200'}`}
                  >
                    {formatLabel(tagId)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1 text-xs text-slate-500">
            <div>Contacted: {contactInfo?.contacted ? 'Yes' : 'No'}</div>
            <div>Last contact: {contactInfo?.last ? new Date(contactInfo.last).toLocaleString() : '—'}</div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
