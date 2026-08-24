import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader, SectionCard } from '../components/PageToolkit';
import CrmStageSelect from '../components/CrmStageSelect';
import {
  useCase,
  useCaseMeta,
  useCaseMessages,
  useCaseActivity,
  useResendMessage,
  useUpdateCaseCrm,
  useUploadCaseDocument,
  useUpdateCaseDocument,
  useDeleteCaseDocument,
  useCreateCaseActivity,
  useUpdateCaseStage,
  useEnrichmentProviders,
  useCaseEnrichment,
  useRunCaseEnrichment,
  useSelectCaseEnrichment,
  useHarrisSheriffEnrichment,
  useRunHarrisSheriffEnrichment,
} from '../hooks/cases';
import { useRelatedParties, useRelatedPartyPull } from '../hooks/enrichment';
import { useCheckins, useTriggerCheckInPing } from '../hooks/checkins';
import { useToast } from '../components/ToastContext';
import { stageLabel } from '../lib/stage';
import { useUser } from '../components/UserContext';

const formatMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return `$${num.toLocaleString()}`;
};

const formatRelative = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '—';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const splitCaseName = (value = '') => {
  const source = String(value || '').trim();
  if (!source) {
    return { firstName: '', lastName: '', fullName: '' };
  }
  const parts = source.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', fullName: source };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
    fullName: source,
  };
};

const formatAddressDisplay = (address) => {
  if (!address || typeof address !== 'object') return '';
  const line1 = address.streetLine1 || address.line1 || '';
  const line2 = address.streetLine2 || address.line2 || '';
  const city = address.city || '';
  const state = address.stateCode || address.state || '';
  const postal = address.postalCode || address.zip || '';

  const cityState = [city, state].filter(Boolean).join(', ');
  const parts = [line1, line2, cityState, postal].filter((part) => part && part.trim().length > 0);
  return parts.join('\n');
};

const formatPhone = (value) => {
  if (!value) return '';
  const v = String(value);
  const digits = v.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return v;
};

const FOLLOW_UP_PRESETS = [
  { id: 'today', label: 'Later today', offsetHours: 4 },
  { id: 'tomorrow', label: 'Tomorrow 9am', offsetDays: 1, setHour: 9 },
  { id: 'threeDays', label: 'In 3 days', offsetDays: 3, setHour: 9 },
  { id: 'nextWeek', label: 'Next week', offsetDays: 7, setHour: 9 },
];

const ACTIVITY_PRESETS = [
  { id: 'left-voicemail', label: 'Left voicemail', note: 'Left voicemail for client.', followOffsetDays: 1, followHour: 10 },
  { id: 'spoke-client', label: 'Spoke with client', note: 'Spoke with client and confirmed next steps.', followOffsetDays: 2, followHour: 9 },
  { id: 'text-sent', label: 'Sent text message', note: 'Sent follow-up text message.', followOffsetDays: 1, followHour: 12 },
  { id: 'docs-requested', label: 'Requested documents', note: 'Requested required documents from client.', followOffsetDays: 3, followHour: 11 },
];

const createEmptyCrmDetails = () => ({
  qualificationNotes: '',
  documents: [],
  followUpAt: null,
  assignedTo: '',
  address: { streetLine1: '', streetLine2: '', city: '', stateCode: '', postalCode: '' },
  phone: '',
  acceptance: { accepted: false, acceptedAt: null, notes: '' },
  denial: { denied: false, deniedAt: null, reason: '', notes: '' },
  attachments: [],
});

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'checkins', label: 'Check-ins' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'crm', label: 'CRM' },
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'documents', label: 'Documents' },
  { id: 'communications', label: 'Comms' },
  { id: 'activity', label: 'Activity' },
];

// ── Harris Sheriff Verification panel ────────────────────────────────────────

function HarrisSheriffVerificationPanel({ spn }) {
  const paddedSpn = String(spn || '').replace(/\D/g, '').padStart(8, '0');
  const { data: enrichData, isLoading, refetch } = useHarrisSheriffEnrichment(paddedSpn);
  const runMutation = useRunHarrisSheriffEnrichment();

  const enrichment = enrichData?.enrichment;
  const custodyStatus = enrichment?.custody_status;
  const isNotInCustody = custodyStatus === 'not_in_custody';
  const isPending = runMutation.isPending;

  async function handleRunEnrichment() {
    try {
      await runMutation.mutateAsync({ spn: paddedSpn, dry_run: false });
      refetch();
    } catch { /* errors surface via runMutation.isError */ }
  }

  return (
    <SectionCard
      title="Harris Sheriff Verification"
      subtitle={`SPN ${paddedSpn} — Harris County Sheriff JailInfo custody check`}
    >
      {/* Loading from cache */}
      {isLoading && (
        <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
          <svg className="h-4 w-4 animate-spin text-purple-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading custody status…
        </div>
      )}

      {/* Running enrichment progress */}
      {isPending && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-4 space-y-2 mb-3">
          <div className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 animate-spin text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-purple-800">Checking Harris Sheriff JailInfo…</p>
              <p className="text-xs text-purple-600">SPN: {paddedSpn}</p>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-purple-100">
            <div
              className="h-full rounded-full bg-purple-500"
              style={{ width: '40%', animation: 'hsv-progress 1.4s ease-in-out infinite' }}
            />
          </div>
          <style>{`@keyframes hsv-progress { 0% { transform: translateX(-200%); width: 40%; } 100% { transform: translateX(350%); width: 40%; } }`}</style>
        </div>
      )}

      {/* Run error */}
      {runMutation.isError && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          ❌ Enrichment failed — {runMutation.error?.message || 'unknown error'}
        </div>
      )}

      {/* No enrichment on file */}
      {!isLoading && !enrichment && !isPending && (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            No Sheriff enrichment on file for SPN {paddedSpn}.
          </div>
          <button
            type="button"
            onClick={handleRunEnrichment}
            disabled={isPending}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
          >
            Run Enrichment
          </button>
        </div>
      )}

      {/* Stored enrichment data */}
      {!isLoading && enrichment && (
        <div className="space-y-3">
          {isNotInCustody && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>
                Confirmed Not in Custody — Released or Bailed.{' '}
                <span className="font-normal text-amber-700">This person is no longer a prospect.</span>
              </span>
            </div>
          )}
          {custodyStatus === 'in_custody' && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
              <span className="mt-0.5 shrink-0">🔒</span>
              <span>Confirmed In Custody</span>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {[
              ['Full name', enrichment.full_name],
              ['SPN', enrichment.confirmed_spn || enrichment.spn],
              ['Custody status', custodyStatus?.replace(/_/g, ' ')],
              ['Facility', enrichment.facility],
              ['Housing', enrichment.housing_location],
              ['Booking status', enrichment.booking_status],
              ['Release status', enrichment.release_status],
              ['Date of birth', enrichment.dob],
              ['Age', enrichment.age],
              ['Sex', enrichment.sex],
              ['Race', enrichment.race],
              ['Info accurate as of', enrichment.info_accurate_as_of],
              ['Last checked', enrichment.last_checked_at
                ? new Date(enrichment.last_checked_at).toLocaleString()
                : null],
            ].map(([label, val]) =>
              val ? (
                <div key={label}>
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="text-slate-800">{val}</dd>
                </div>
              ) : null
            )}
          </dl>
          {enrichment.warnings?.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              <strong>Warnings:</strong> {enrichment.warnings.join('; ')}
            </div>
          )}
          <button
            type="button"
            onClick={handleRunEnrichment}
            disabled={isPending}
            className="rounded-lg border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-60"
          >
            {isPending ? 'Running…' : 'Re-run Enrichment'}
          </button>
        </div>
      )}
    </SectionCard>
  );
}

export default function CaseDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { caseId } = useParams();
  const [searchParams] = useSearchParams();

  const { data, isLoading, isError, error, refetch } = useCase(caseId);
  const { data: meta } = useCaseMeta();
  const { data: messagesData, isLoading: messagesLoading, isError: messagesError } = useCaseMessages(caseId);
  const { data: activityData, isLoading: activityLoading, isError: activityError } = useCaseActivity(caseId);
  const { data: caseCheckinsData } = useCheckins({ scope: 'all', caseId }, { enabled: Boolean(caseId) });
  const { currentUser } = useUser();

  const updateCrm = useUpdateCaseCrm({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'CRM updated', message: 'Case CRM details saved.' });
      if (caseId) {
        queryClient.invalidateQueries({ queryKey: ['case', caseId] });
        queryClient.invalidateQueries({ queryKey: ['cases'] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Save failed', message: err?.message || 'Unable to save CRM details.' });
    },
  });

  const updateStage = useUpdateCaseStage({
    onSuccess: (_res, vars) => {
      pushToast({ variant: 'success', title: 'Stage updated', message: 'Stage saved successfully.' });
      setStageChangeNote('');
      if (vars?.caseId) {
        queryClient.invalidateQueries({ queryKey: ['case', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['cases'] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Stage update failed', message: err?.message || 'Unable to update stage.' });
    },
  });

  const uploadDocument = useUploadCaseDocument({
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Document uploaded', message: 'Attachment added to CRM.' });
      setUploadFile(null);
      setUploadLabel('');
      setUploadNote('');
      setUploadChecklistKey('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (caseId) {
        queryClient.invalidateQueries({ queryKey: ['case', caseId] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Upload failed', message: err?.message || 'Unable to upload document.' });
    },
  });

  const ageInfo = useMemo(() => {
    const ref = data?.booking_date;
    if (!ref) return { label: '—', hours: null, days: null };
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(ref) ? `${ref}T00:00:00Z` : ref;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { label: '—', hours: null, days: null };
    const diffMs = Date.now() - d.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const label = hours < 24 ? `${hours}h` : `${days}d ${hours % 24}h`;
    return { label, hours, days };
  }, [data?.booking_date]);

  const updateAttachment = useUpdateCaseDocument({
    onSuccess: (response, vars) => {
      const attachment = response?.attachment;
      if (vars?.caseId && attachment) {
        queryClient.setQueryData(['case', vars.caseId], (old) => {
          if (!old) return old;
          const oldAttachments = Array.isArray(old.crm_details?.attachments)
            ? old.crm_details.attachments.slice()
            : [];
          const idx = oldAttachments.findIndex((att) => att?.id === attachment.id);
          if (idx !== -1) {
            oldAttachments[idx] = { ...oldAttachments[idx], ...attachment };
          }
          return {
            ...old,
            crm_details: {
              ...old.crm_details,
              attachments: oldAttachments,
            },
          };
        });
        queryClient.invalidateQueries({ queryKey: ['case', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
      cancelAttachmentEdit();
      pushToast({ variant: 'success', title: 'Document updated', message: 'Attachment details saved.' });
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Update failed', message: err?.message || 'Unable to update document.' });
    },
  });

  const deleteAttachment = useDeleteCaseDocument({
    onSuccess: (response, vars) => {
      const removed = response?.removed;
      if (vars?.caseId) {
        queryClient.setQueryData(['case', vars.caseId], (old) => {
          if (!old) return old;
          const oldAttachments = Array.isArray(old.crm_details?.attachments)
            ? old.crm_details.attachments.filter((att) => att?.id !== (removed?.id || vars.attachmentId))
            : [];
          return {
            ...old,
            crm_details: {
              ...old.crm_details,
              attachments: oldAttachments,
            },
          };
        });
        queryClient.invalidateQueries({ queryKey: ['case', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
      if (editingAttachmentId && editingAttachmentId === (vars?.attachmentId || removed?.id)) {
        cancelAttachmentEdit();
      }
      pushToast({ variant: 'success', title: 'Document removed', message: 'Attachment deleted from CRM.' });
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Delete failed', message: err?.message || 'Unable to delete document.' });
    },
    onSettled: () => {
      setDeletingAttachmentId('');
    },
  });

  const createActivity = useCreateCaseActivity({
    onSuccess: (_res, vars) => {
      pushToast({ variant: 'success', title: 'Activity logged', message: 'Interaction saved to timeline.' });
      setActivityNote('');
      setActivityOutcome('');
      setActivityFollowUp('');
      if (vars?.caseId) {
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['case', vars.caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Save failed', message: err?.message || 'Unable to log activity.' });
    },
  });

  const resendMessage = useResendMessage({
    onSuccess: (_res, vars) => {
      pushToast({ variant: 'success', title: 'Message queued', message: 'A retry was queued successfully.' });
      if (vars?.caseId) {
        queryClient.invalidateQueries({ queryKey: ['caseMessages', vars.caseId] });
        queryClient.invalidateQueries({ queryKey: ['caseActivity', vars.caseId] });
      }
    },
    onError: (err) => {
      pushToast({ variant: 'error', title: 'Retry failed', message: err?.message || 'Unable to queue retry.' });
    },
  });

  const crmDetails = useMemo(() => {
    const defaults = createEmptyCrmDetails();
    if (!data?.crm_details) return defaults;
    const base = data.crm_details;
    const acceptance = {
      ...defaults.acceptance,
      ...(base.acceptance || {}),
      accepted: Boolean(base.acceptance?.accepted),
    };
    const denial = {
      ...defaults.denial,
      ...(base.denial || {}),
      denied: Boolean(base.denial?.denied),
    };
    return {
      ...defaults,
      ...base,
      qualificationNotes: base.qualificationNotes ?? defaults.qualificationNotes,
      followUpAt: base.followUpAt ?? defaults.followUpAt,
      assignedTo: base.assignedTo ?? defaults.assignedTo,
      documents: Array.isArray(base.documents) ? base.documents : defaults.documents,
      attachments: Array.isArray(base.attachments) ? base.attachments : defaults.attachments,
      acceptance,
      denial,
    };
  }, [data?.crm_details]);

  const manualTags = useMemo(
    () => (Array.isArray(data?.manual_tags) ? Array.from(new Set(data.manual_tags)).sort() : []),
    [data?.manual_tags]
  );

  const checklistItems = crmDetails.documents;
  const attachments = crmDetails.attachments;

  const totalChecklist = checklistItems.length;
  const completedChecklist = checklistItems.filter((item) => item?.status === 'completed').length;
  const requiredChecklist = checklistItems.filter((item) => item?.required).length;
  const requiredCompleted = checklistItems.filter((item) => item?.required && item?.status === 'completed').length;
  const missingRequiredDocs = checklistItems.filter((item) => item?.required && item?.status !== 'completed');
  const checklistProgress = totalChecklist ? Math.round((completedChecklist / totalChecklist) * 100) : 0;

  const stageDisplay = stageLabel(data?.crm_stage || 'new');
  const followUpDisplay = formatRelative(crmDetails.followUpAt);
  const lastContactDisplay = formatRelative(data?.last_contact_at);
  const dobDisplay = useMemo(() => {
    const v = data?.dob;
    if (!v) return '—';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = String(v).split('-');
      return `${Number(m)}/${Number(d)}/${y}`;
    }
    return String(v);
  }, [data?.dob]);
  const bondDisplay = (() => {
    const numeric = formatMoney(data?.bond_amount);
    if (numeric) return numeric;
    if (data?.bond_status) return data.bond_status.replace(/_/g, ' ');
    if (data?.bond_label) return data.bond_label;
    if (data?.bond) return String(data.bond);
    return '—';
  })();

  const stageOptions = useMemo(
    () => (Array.isArray(meta?.stages) && meta.stages.length ? meta.stages : undefined),
    [meta]
  );

  const messageItems = Array.isArray(messagesData?.items) ? messagesData.items : [];
  const messageCount = messageItems.length;

  const activityEvents = Array.isArray(activityData?.events) ? activityData.events : [];
  const activityCount = activityEvents.length;
  const contactAddressDisplay = useMemo(
    () => formatAddressDisplay(data?.crm_details?.address || data?.address || null),
    [data?.crm_details?.address, data?.address]
  );

  const headerSubtitle = useMemo(() => {
    const parts = [];
    if (data?.spn) parts.push(`SPN ${data.spn}`);
    if (data?.case_number) parts.push(`Case #${data.case_number}`);
    if (dobDisplay && dobDisplay !== '—') parts.push(`DOB ${dobDisplay}`);
    return parts.length ? parts.join(' • ') : 'Full record overview';
  }, [data?.spn, data?.case_number, dobDisplay]);
  const messagePhoneOptions = useMemo(() => {
    const options = [];
    const seen = new Set();
    const push = (value, label) => {
      if (!value || typeof value !== 'string') return;
      const digits = value.replace(/[^0-9]/g, '');
      if (digits.length < 10) return;
      const withoutCountry = digits.startsWith('1') ? digits.slice(1) : digits;
      const e164 = `+1${withoutCountry}`;
      if (seen.has(e164)) return;
      seen.add(e164);
      options.push({ label, value: e164 });
    };

    push(data?.crm_details?.phone, data?.full_name ? `${data.full_name} (CRM)` : 'Client phone');
    push(data?.phone, 'Case record phone');
    push(data?.primary_phone, 'Primary phone');
  push(data?.phone_nbr1, 'Alt phone 1');
  push(data?.phone_nbr2, 'Alt phone 2');
  push(data?.phone_nbr3, 'Alt phone 3');

    if (Array.isArray(data?.crm_details?.contacts)) {
      data.crm_details.contacts.forEach((contact, index) => {
        push(contact?.phone, contact?.name ? contact.name : `Contact ${index + 1}`);
      });
    }
    if (Array.isArray(data?.crm_details?.references)) {
      data.crm_details.references.forEach((ref, index) => {
        push(ref?.phone, ref?.name ? ref.name : `Reference ${index + 1}`);
      });
    }

    return options;
  }, [
    data?.crm_details?.contacts,
    data?.crm_details?.phone,
    data?.crm_details?.references,
    data?.full_name,
    data?.phone,
    data?.primary_phone,
    data?.phone_nbr1,
    data?.phone_nbr2,
    data?.phone_nbr3,
  ]);
  const caseCheckins = Array.isArray(caseCheckinsData?.items) ? caseCheckinsData.items : [];
  const gpsCheckins = caseCheckins.filter((checkin) => Boolean(checkin?.gpsEnabled));
  const triggerPing = useTriggerCheckInPing();
  const { data: enrichmentProvidersData } = useEnrichmentProviders();
  const providerOptions = useMemo(
    () => (Array.isArray(enrichmentProvidersData?.providers) ? enrichmentProvidersData.providers : []),
    [enrichmentProvidersData?.providers],
  );
  const providersLoaded = Boolean(enrichmentProvidersData);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const defaultProviderId = useMemo(() => {
    const flagged = providerOptions.find((provider) => provider.default);
    return flagged?.id || providerOptions[0]?.id || '';
  }, [providerOptions]);

  useEffect(() => {
    if (!providerOptions.length) {
      setSelectedProviderId('');
    } else if (!selectedProviderId && defaultProviderId) {
      setSelectedProviderId(defaultProviderId);
    }
  }, [providerOptions, selectedProviderId, defaultProviderId]);

  const handleMessageCase = () => {
    if (!data) return;
    const identifier = data.case_number || caseId;
    if (!identifier) {
      pushToast({ variant: 'error', title: 'Missing case number', message: 'Unable to open composer without a case number.' });
      return;
    }
    if (!messagePhoneOptions.length) {
      pushToast({ variant: 'warning', title: 'No phone number on file', message: 'Add a mobile number in CRM or enrichment before sending an SMS.' });
      return;
    }

    const params = new URLSearchParams({ caseId: identifier, to: messagePhoneOptions[0].value });
    navigate(`/messages?${params.toString()}`);
  };

  const queuePingForCheckIn = (checkInId) => {
    if (!checkInId) {
      pushToast({ variant: 'error', title: 'Ping failed', message: 'Unable to determine which check-in to ping.' });
      return;
    }
    triggerPing.mutate(checkInId, {
      onSuccess: () => {
        pushToast({ variant: 'success', title: 'Ping queued', message: 'Manual GPS ping has been queued.' });
        queryClient.invalidateQueries({ queryKey: ['checkins'] });
        queryClient.invalidateQueries({ queryKey: ['checkins', 'detail', checkInId] });
        queryClient.invalidateQueries({ queryKey: ['checkins', 'timeline', checkInId] });
      },
      onError: (err) => {
        pushToast({ variant: 'error', title: 'Ping failed', message: err?.message || 'Unable to queue GPS ping.' });
      },
    });
  };

  const handlePingNow = () => {
    if (!gpsCheckins.length) {
      pushToast({ variant: 'warning', title: 'No GPS check-ins', message: 'Enable GPS on a check-in before triggering a ping.' });
      return;
    }

    const targetEntry = gpsCheckins.reduce((best, current) => {
      const ts = current?.dueAt ? new Date(current.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(ts)) return best;
      if (!best) return { item: current, ts };
      return ts < best.ts ? { item: current, ts } : best;
    }, null);

    const targetCheckIn = targetEntry?.item || gpsCheckins[0];
    if (!targetCheckIn?.id) {
      pushToast({ variant: 'error', title: 'Ping failed', message: 'Unable to determine which check-in to ping.' });
      return;
    }

    queuePingForCheckIn(targetCheckIn.id);
  };

  const defaultEnrichmentInput = useMemo(() => {
    const nameParts = splitCaseName(data?.full_name || '');
    const crmAddress = data?.crm_details?.address || {};
    const recordAddress = data?.address || {};
    const recordPhone = data?.crm_details?.phone || data?.phone || data?.primary_phone || '';
    return {
      fullName: nameParts.fullName,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      city: data?.city || crmAddress.city || recordAddress.city || '',
      stateCode:
        data?.state
        || data?.stateCode
        || crmAddress.stateCode
        || recordAddress.state
        || '',
      postalCode:
        data?.postal_code
        || data?.postalCode
        || data?.zip
        || crmAddress.postalCode
        || recordAddress.postalCode
        || recordAddress.zip
        || '',
      addressLine1:
        data?.address_line_1
        || data?.addressLine1
        || crmAddress.streetLine1
        || recordAddress.line1
        || '',
      addressLine2:
        data?.address_line_2
        || data?.addressLine2
        || crmAddress.streetLine2
        || recordAddress.line2
        || '',
      phone: recordPhone,
    };
  }, [
    data?.full_name,
    data?.city,
    data?.state,
    data?.stateCode,
    data?.postal_code,
    data?.postalCode,
    data?.zip,
    data?.address_line_1,
    data?.addressLine1,
    data?.address_line_2,
    data?.addressLine2,
    data?.phone,
    data?.primary_phone,
    data?.crm_details?.address,
    data?.crm_details?.phone,
    data?.address,
  ]);

  const initialTab = (() => {
    const queryTab = searchParams.get('tab');
    return TABS.some((tab) => tab.id === queryTab) ? queryTab : 'overview';
  })();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [stageDraft, setStageDraft] = useState('new');
  const [stageChangeNote, setStageChangeNote] = useState('');
  const [qualificationNotes, setQualificationNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [decision, setDecision] = useState('pending');
  const [acceptanceNotes, setAcceptanceNotes] = useState('');
  const [denialReason, setDenialReason] = useState('');
  const [denialNotes, setDenialNotes] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploadNote, setUploadNote] = useState('');
  const [uploadChecklistKey, setUploadChecklistKey] = useState('');
  const [activityNote, setActivityNote] = useState('');
  const [activityOutcome, setActivityOutcome] = useState('');
  const [activityFollowUp, setActivityFollowUp] = useState('');
  const [activityPreset, setActivityPreset] = useState('');
  // CRM contact fields
  const [contactStreet1, setContactStreet1] = useState('');
  const [contactStreet2, setContactStreet2] = useState('');
  const [contactCity, setContactCity] = useState('');
  const [contactStateCode, setContactStateCode] = useState('');
  const [contactPostalCode, setContactPostalCode] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [editingAttachmentId, setEditingAttachmentId] = useState('');
  const [attachmentLabel, setAttachmentLabel] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');
  const [attachmentChecklist, setAttachmentChecklist] = useState('');
  const [deletingAttachmentId, setDeletingAttachmentId] = useState('');
  const [enrichmentInputs, setEnrichmentInputs] = useState({});
  const currentEnrichmentInput = useMemo(() => {
    if (!selectedProviderId) return defaultEnrichmentInput;
    return enrichmentInputs[selectedProviderId] || defaultEnrichmentInput;
  }, [enrichmentInputs, selectedProviderId, defaultEnrichmentInput]);
  const [selectingRecordId, setSelectingRecordId] = useState('');
  const [reEnrichingPartyId, setReEnrichingPartyId] = useState('');
  const [expandedActivityDetails, setExpandedActivityDetails] = useState({}); // Track expanded enrichment audit accordions
  const fileInputRef = useRef(null);

  useEffect(() => {
    setStageDraft(data?.crm_stage || 'new');
  }, [data?.crm_stage]);

  useEffect(() => {
    if (!selectedProviderId) return;
    setEnrichmentInputs((prev) => {
      const existing = prev[selectedProviderId];
      if (existing) return prev;
      return { ...prev, [selectedProviderId]: defaultEnrichmentInput };
    });
  }, [selectedProviderId, defaultEnrichmentInput]);

  useEffect(() => {
    setQualificationNotes(crmDetails.qualificationNotes || '');
    setAssignedTo(crmDetails.assignedTo || '');
    setAcceptanceNotes(crmDetails.acceptance?.notes || '');
    setDenialReason(crmDetails.denial?.reason || '');
    setDenialNotes(crmDetails.denial?.notes || '');
    const addr = crmDetails.address || {};
    setContactStreet1(addr.streetLine1 || '');
    setContactStreet2(addr.streetLine2 || '');
    setContactCity(addr.city || '');
    setContactStateCode(addr.stateCode || '');
    setContactPostalCode(addr.postalCode || '');
    setContactPhone(crmDetails.phone || '');

    if (crmDetails.followUpAt) {
      const dt = new Date(crmDetails.followUpAt);
      setFollowUpAt(Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 16));
    } else {
      setFollowUpAt('');
    }

    if (crmDetails.acceptance?.accepted) {
      setDecision('accepted');
    } else if (crmDetails.denial?.denied) {
      setDecision('denied');
    } else {
      setDecision('pending');
    }
  }, [crmDetails]);

  useEffect(() => {
    const queryTab = searchParams.get('tab');
    if (queryTab && TABS.some((tab) => tab.id === queryTab)) {
      setActiveTab(queryTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!editingAttachmentId) return;
    const exists = attachments.some((att) => att?.id === editingAttachmentId);
    if (!exists) {
      cancelAttachmentEdit();
    }
  }, [attachments, editingAttachmentId]);

  const {
    data: enrichmentData,
    isLoading: enrichmentLoading,
    isFetching: enrichmentFetching,
    refetch: refetchEnrichment,
  } = useCaseEnrichment(caseId, selectedProviderId, {
    enabled: Boolean(caseId) && Boolean(selectedProviderId) && activeTab === 'enrichment',
  });

  const {
    data: relatedPartiesData,
    isLoading: relatedPartiesLoading,
    refetch: refetchRelatedParties,
  } = useRelatedParties(data?.spn, {
    enabled: Boolean(data?.spn) && activeTab === 'enrichment',
  });
  const relatedParties = Array.isArray(relatedPartiesData?.rows) ? relatedPartiesData.rows : [];

  const permittedRoles = useMemo(
    () => (Array.isArray(currentUser?.roles) ? currentUser.roles : []),
    [currentUser?.roles],
  );
  const canRunEnrichment = useMemo(
    () => permittedRoles.some((role) => ['SuperUser', 'Admin', 'DepartmentLead', 'Employee'].includes(role)),
    [permittedRoles]
  );
  const canForceByRole = useMemo(
    () => permittedRoles.some((role) => ['SuperUser', 'Admin'].includes(role)),
    [permittedRoles]
  );
  const activeProvider = useMemo(
    () => providerOptions.find((provider) => provider.id === selectedProviderId) || null,
    [providerOptions, selectedProviderId]
  );
  const supportsForce = Boolean(activeProvider?.supportsForce);
  const providerLabel = activeProvider?.label || (selectedProviderId ? selectedProviderId.toUpperCase() : 'Enrichment');

  const runEnrichment = useRunCaseEnrichment({
    onSuccess: (response) => {
      const count = response?.enrichment?.candidates?.length ?? 0;
      pushToast({
        variant: 'success',
        title: `${providerLabel} enrichment complete`,
        message: count ? `${count} potential matches returned.` : 'No matches were returned for this search.',
      });
      refetchEnrichment();
    },
    onError: (err) => {
      pushToast({
        variant: 'error',
        title: 'Enrichment failed',
        message: err?.message || `Unable to run ${providerLabel} enrichment right now.`,
      });
    },
  });

  const selectEnrichment = useSelectCaseEnrichment({
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Match attached',
        message: 'The selected record has been linked to this case.',
      });
      refetchEnrichment();
    },
    onError: (err) => {
      pushToast({
        variant: 'error',
        title: 'Unable to attach record',
        message: err?.message || 'Failed to attach the selected enrichment record.',
      });
    },
    onSettled: () => setSelectingRecordId(''),
  });

  const reEnrichParty = useRelatedPartyPull({
    onSuccess: (response) => {
      const gained = response?.details?.[0]?.gainedData;
      pushToast({
        variant: 'success',
        title: 'Re-enrich complete',
        message: gained ? 'New contact data was found.' : 'No new contact data was found.',
      });
      refetchRelatedParties();
    },
    onError: (err) => {
      pushToast({
        variant: 'error',
        title: 'Re-enrich failed',
        message: err?.message || 'Unable to re-enrich this party right now.',
      });
    },
    onSettled: () => setReEnrichingPartyId(''),
  });

  const enrichmentDoc = enrichmentData?.enrichment || null;
  const enrichmentCandidates = Array.isArray(enrichmentDoc?.candidates) ? enrichmentDoc.candidates : [];
  const enrichmentSelected = useMemo(
    () => (Array.isArray(enrichmentDoc?.selectedRecords) ? enrichmentDoc.selectedRecords : []),
    [enrichmentDoc?.selectedRecords],
  );
  const enrichmentSelectedSet = useMemo(
    () => new Set(enrichmentSelected.map((entry) => entry?.recordId).filter(Boolean)),
    [enrichmentSelected]
  );
  const enrichmentNextRefresh = useMemo(() => {
    if (enrichmentData?.nextRefreshAt) {
      const dt = new Date(enrichmentData.nextRefreshAt);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    if (enrichmentDoc?.expiresAt) {
      const dt = new Date(enrichmentDoc.expiresAt);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    return null;
  }, [enrichmentData?.nextRefreshAt, enrichmentDoc?.expiresAt]);
  const enrichmentRefreshing = activeTab === 'enrichment' && (enrichmentLoading || enrichmentFetching);

  const handleEnrichmentFieldChange = (field, value) => {
    if (!selectedProviderId) return;
    setEnrichmentInputs((prev) => ({
      ...prev,
      [selectedProviderId]: { ...currentEnrichmentInput, [field]: value },
    }));
  };

  const handleRunEnrichment = (force = false) => {
    if (!caseId || !canRunEnrichment || !selectedProviderId) return;

    const nameFromParts = `${(currentEnrichmentInput.firstName || '').trim()} ${(currentEnrichmentInput.lastName || '').trim()}`.trim();
    const payload = {
      ...currentEnrichmentInput,
      fullName: nameFromParts || currentEnrichmentInput.fullName || undefined,
    };

    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => {
        if (typeof value === 'string') return value.trim().length > 0;
        return value != null;
      })
    );

    if (!cleanedPayload.fullName && !cleanedPayload.firstName && !cleanedPayload.lastName) {
      pushToast({
        variant: 'warn',
        title: 'Name required',
        message: 'Enter at least a first or last name before running enrichment.',
      });
      return;
    }

    if (force && supportsForce && canForceByRole) {
      cleanedPayload.force = true;
    }

    runEnrichment.mutate({ caseId, providerId: selectedProviderId, payload: cleanedPayload });
  };

  const handleSelectEnrichmentRecord = (recordId) => {
    if (!caseId || !recordId || !selectedProviderId) return;
    setSelectingRecordId(recordId);
    selectEnrichment.mutate({ caseId, providerId: selectedProviderId, recordId });
  };

  const handleReEnrichParty = (party) => {
    if (!data?.spn || !party?.partyId) return;
    setReEnrichingPartyId(party.partyId);
    reEnrichParty.mutate({ subjectId: data.spn, partyId: party.partyId, partyName: party.name, aggressive: true });
  };

  const handleEnrichmentSubmit = (event) => {
    event.preventDefault();
    handleRunEnrichment(false);
  };

  const handleForceEnrichment = () => {
    if (!supportsForce || !canForceByRole) return;
    handleRunEnrichment(true);
  };

  const handleStageSave = () => {
    if (!caseId) return;
    if (!stageDraft) {
      pushToast({ variant: 'warn', title: 'Select stage', message: 'Choose a stage before saving.' });
      return;
    }
    if (stageDraft === (data?.crm_stage || 'new') && !stageChangeNote.trim()) {
      pushToast({ variant: 'info', title: 'No changes', message: 'Select a different stage or include a note.' });
      return;
    }
    if (stageDraft === 'accepted' && missingRequiredDocs.length) {
      pushToast({
        variant: 'warn',
        title: 'Checklist incomplete',
        message: 'Complete all required checklist items before marking the case as accepted.',
      });
      return;
    }
    updateStage.mutate({ caseId, stage: stageDraft, note: stageChangeNote.trim() || undefined });
  };

  const handleCrmSave = (event) => {
    event.preventDefault();
    if (!caseId) return;
    const payload = {
      qualificationNotes,
      followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
      assignedTo,
      address: {
        streetLine1: contactStreet1,
        streetLine2: contactStreet2,
        city: contactCity,
        stateCode: contactStateCode,
        postalCode: contactPostalCode,
      },
      phone: contactPhone,
    };

    if (decision === 'accepted') {
      payload.acceptance = {
        accepted: true,
        acceptedAt: new Date().toISOString(),
        notes: acceptanceNotes,
      };
      payload.denial = { denied: false, deniedAt: null, reason: '', notes: '' };
    } else if (decision === 'denied') {
      payload.denial = {
        denied: true,
        deniedAt: new Date().toISOString(),
        reason: denialReason,
        notes: denialNotes,
      };
      payload.acceptance = { accepted: false, acceptedAt: null, notes: '' };
    } else {
      payload.acceptance = { accepted: false, acceptedAt: null, notes: acceptanceNotes };
      payload.denial = { denied: false, deniedAt: null, reason: denialReason, notes: denialNotes };
    }

    updateCrm.mutate({ caseId, payload });
  };

  const applyFollowUpPreset = (preset) => {
    if (!preset) return;
    const now = new Date();
    if (preset.offsetDays) {
      now.setDate(now.getDate() + preset.offsetDays);
    }
    if (preset.offsetHours) {
      now.setHours(now.getHours() + preset.offsetHours);
    }
    if (typeof preset.setHour === 'number') {
      now.setHours(preset.setHour, 0, 0, 0);
    } else {
      now.setMinutes(0, 0, 0);
    }
    const isoLocal = now.toISOString().slice(0, 16);
    setFollowUpAt(isoLocal);
  };

  const toggleChecklistItem = (item) => {
    if (!caseId) return;
    const updatedDocs = checklistItems.map((doc) => {
      if ((doc?.key || doc?.label) !== (item?.key || item?.label)) return doc;
      if (doc?.status === 'completed') {
        return { ...doc, status: 'pending', completedAt: null };
      }
      return { ...doc, status: 'completed', completedAt: new Date().toISOString() };
    });
    updateCrm.mutate({ caseId, payload: { documents: updatedDocs } });
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    setUploadFile(file || null);
  };

  const handleDocumentUpload = (event) => {
    event.preventDefault();
    if (!caseId || !uploadFile) {
      pushToast({ variant: 'warn', title: 'Select a file', message: 'Choose a document to upload.' });
      return;
    }
    uploadDocument.mutate({
      caseId,
      file: uploadFile,
      label: uploadLabel.trim() || undefined,
      note: uploadNote.trim() || undefined,
      checklistKey: uploadChecklistKey || undefined,
    });
  };

  const cancelAttachmentEdit = () => {
    setEditingAttachmentId('');
    setAttachmentLabel('');
    setAttachmentNote('');
    setAttachmentChecklist('');
  };

  const startAttachmentEdit = (attachment) => {
    if (!attachment?.id) return;
    setEditingAttachmentId(attachment.id);
    setAttachmentLabel(attachment.label || attachment.originalName || attachment.filename || '');
    setAttachmentNote(attachment.note || '');
    setAttachmentChecklist(attachment.checklistKey || '');
  };

  const handleAttachmentSave = (event) => {
    if (event) event.preventDefault();
    if (!caseId || !editingAttachmentId) return;
    const trimmedLabel = attachmentLabel.trim();
    if (!trimmedLabel) {
      pushToast({ variant: 'warn', title: 'Label required', message: 'Add a brief label before saving.' });
      return;
    }
    const payload = {
      label: trimmedLabel,
      note: attachmentNote.trim(),
      checklistKey: attachmentChecklist || '',
    };
    updateAttachment.mutate({ caseId, attachmentId: editingAttachmentId, payload });
  };

  const handleAttachmentDelete = (attachment) => {
    if (!caseId || !attachment?.id) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('Remove this document from the CRM? This cannot be undone.')
      : true;
    if (!confirmed) return;
    setDeletingAttachmentId(attachment.id);
    deleteAttachment.mutate({ caseId, attachmentId: attachment.id });
  };

  const handleActivitySubmit = (event) => {
    event.preventDefault();
    if (!caseId) return;
    if (!activityNote.trim()) {
      pushToast({ variant: 'warn', title: 'Note required', message: 'Add a quick note before logging activity.' });
      return;
    }

    const payload = { note: activityNote.trim() };
    if (activityOutcome.trim()) payload.outcome = activityOutcome.trim();
    if (activityFollowUp) {
      const dt = new Date(activityFollowUp);
      if (Number.isNaN(dt.getTime())) {
        pushToast({ variant: 'warn', title: 'Invalid follow-up', message: 'Select a valid follow-up date and time.' });
        return;
      }
      payload.followUpAt = dt.toISOString();
    }

    createActivity.mutate({ caseId, payload });
  };

  const applyActivityPreset = (presetId) => {
    const preset = ACTIVITY_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      setActivityPreset('');
      return;
    }
    setActivityPreset(preset.id);
    if (preset.note) {
      setActivityNote(preset.note);
    }
    if (preset.label) {
      setActivityOutcome(preset.label);
    }
    if (preset.followOffsetDays != null) {
      const follow = new Date();
      follow.setDate(follow.getDate() + Number(preset.followOffsetDays));
      if (preset.followHour != null) {
        follow.setHours(Number(preset.followHour), 0, 0, 0);
      }
      setActivityFollowUp(follow.toISOString().slice(0, 16));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Loading case…" />
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Loading case details…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Unable to load case" />
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load case: {error?.message || 'Unknown error'}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case detail" subtitle="Case not found" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Case not found.
        </div>
      </div>
    );
  }

  const renderChecklist = () => {
    if (!totalChecklist) {
      return (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No onboarding tasks have been configured for this case yet.
        </div>
      );
    }

    return (
      <ul className="space-y-2">
        {checklistItems.map((item, idx) => {
          const key = item?.key || item?.label || `checklist-${idx}`;
          const label = item?.label || item?.key || 'Checklist item';
          const isRequired = Boolean(item?.required);
          const isCompleted = item?.status === 'completed';

          return (
            <li
              key={key}
              className={`flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm md:flex-row md:items-start md:justify-between ${
                isCompleted ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div>
                <div className="font-medium text-slate-800">{label}</div>
                <div className="text-xs text-slate-500">
                  {isRequired ? 'Required' : 'Optional'}
                  {isCompleted && item?.completedAt ? ` • Completed ${formatRelative(item.completedAt)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isCompleted ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {isCompleted ? 'Done' : 'Pending'}
                </span>
                <button
                  type="button"
                  onClick={() => toggleChecklistItem(item)}
                  disabled={updateCrm.isPending}
                  className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCompleted ? 'Mark pending' : 'Mark complete'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  const overviewContent = (
    <div className="space-y-6">
      <SectionCard title="Case snapshot" subtitle="Latest onboarding status">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatTile label="Stage" value={stageDisplay} />
          <StatTile label="Bond" value={bondDisplay} />
          <StatTile label="Assigned" value={crmDetails.assignedTo || 'Unassigned'} />
          <StatTile label="Next follow-up" value={followUpDisplay} />
          <StatTile label="Age" value={ageInfo.label} hint={data.booking_date ? `Booked ${data.booking_date}` : undefined} />
          <StatTile
            label="Checklist"
            value={totalChecklist ? `${completedChecklist}/${totalChecklist}` : '—'}
            hint={totalChecklist ? `${checklistProgress}% complete` : undefined}
          />
          <StatTile
            label="Last contact"
            value={lastContactDisplay}
            hint={data.contacted ? 'Contacted' : 'No outreach yet'}
          />
        </div>
      </SectionCard>

      <SectionCard title="Case summary" subtitle="Reference details for this client file">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <DetailItem label="SPN" value={data.spn || data.booking_number || '—'} />
            <DetailItem label="Case number" value={data.case_number || '—'} />
            <DetailItem label="Date of birth" value={(() => {
              const v = data?.dob;
              if (!v) return '—';
              // Accept either MM/DD/YYYY or YYYY-MM-DD and display as MM/DD/YYYY
              if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return v;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                const [y, m, d] = v.split('-');
                return `${Number(m)}/${Number(d)}/${y}`;
              }
              return String(v);
            })()} />
            <DetailItem label="Status" value={data.status || '—'} />
            <DetailItem label="County" value={data.county || '—'} />
            <DetailItem label="Category" value={data.category || '—'} />
            <DetailItem label="Agency" value={data.agency || '—'} />
            <DetailItem label="Facility" value={data.facility || '—'} />
          </div>
          <div className="space-y-3">
            <DetailItem label="Primary charge" value={data.charge || data.offense || '—'} />
            <DetailItem label="Manual tags">
              <div className="mt-1 flex flex-wrap gap-2">
                {manualTags.length === 0 ? <span className="text-slate-500">None</span> : null}
                {manualTags.map((tag) => (
                  <span key={`manual-${tag}`} className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                    {tag.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </DetailItem>
            <DetailItem label="Phones">
              <div className="mt-1 flex flex-wrap gap-2">
                {(() => {
                  const list = [];
                  const seen = new Set();
                  const pushPhone = (val) => {
                    if (!val || typeof val !== 'string') return;
                    const digits = val.replace(/\D/g, '');
                    if (digits.length < 10) return;
                    const key = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
                    if (seen.has(key)) return;
                    seen.add(key);
                    list.push(formatPhone(val));
                  };
                  pushPhone(data?.crm_details?.phone);
                  pushPhone(data?.phone);
                  pushPhone(data?.primary_phone);
                  pushPhone(data?.phone_nbr1);
                  pushPhone(data?.phone_nbr2);
                  pushPhone(data?.phone_nbr3);
                  return list.length
                    ? list.map((p) => (
                        <span key={p} className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{p}</span>
                      ))
                    : <span className="text-slate-500">—</span>;
                })()}
              </div>
              {(data?.phones_source || data?.phones_updated_at) ? (
                <div className="mt-1 text-[11px] text-slate-400">
                  {data?.phones_source ? `Source: ${data.phones_source}` : null}
                  {(data?.phones_source && data?.phones_updated_at) ? ' • ' : ''}
                  {data?.phones_updated_at ? `Updated: ${new Date(data.phones_updated_at).toLocaleString()}` : null}
                </div>
              ) : null}
            </DetailItem>
            <DetailItem label="Address">
              <div className="mt-1 whitespace-pre-line text-sm text-slate-800">
                {contactAddressDisplay || '—'}
              </div>
            </DetailItem>
            <DetailItem label="Source" value={data.source || '—'} />
            <DetailItem label="Updated" value={formatRelative(data.updatedAt || data.normalized_at)} />
          </div>
        </div>
      </SectionCard>
    </div>
  );

  const checklistContent = (
    <SectionCard
      title="Onboarding checklist"
      subtitle={totalChecklist
        ? `${completedChecklist}/${totalChecklist} items • ${requiredChecklist ? `${requiredCompleted}/${requiredChecklist} required` : 'No required items'} • ${checklistProgress}% complete`
        : 'No checklist items configured yet'}
    >
      {renderChecklist()}
    </SectionCard>
  );

  const crmContent = (
    <div className="space-y-6">
      <SectionCard title="Stage & ownership" subtitle="Advance the client through the onboarding flow">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="workspace-stage-select">
                Stage
              </label>
              <CrmStageSelect
                id="workspace-stage-select"
                value={stageDraft}
                onChange={(e) => setStageDraft(e.target.value)}
                stageOptions={stageOptions}
                disabled={updateStage.isPending}
                className="mt-1"
              />
            </div>
            <textarea
              value={stageChangeNote}
              onChange={(e) => setStageChangeNote(e.target.value)}
              rows={3}
              placeholder="Add stage note (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={updateStage.isPending}
            />
            {missingRequiredDocs.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Complete required checklist items before accepting: {missingRequiredDocs
                  .map((item) => item.label || item.key || 'Unnamed task')
                  .join(', ')}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleStageSave}
                disabled={updateStage.isPending}
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updateStage.isPending ? 'Updating…' : 'Update stage'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('checklist')}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                View checklist
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist progress</div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span>{completedChecklist}/{totalChecklist || 0} items</span>
              <span>{checklistProgress}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${checklistProgress}%` }} />
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {missingRequiredDocs.length
                ? `${missingRequiredDocs.length} required item${missingRequiredDocs.length === 1 ? '' : 's'} outstanding.`
                : 'All required documents collected.'}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="CRM details" subtitle="Keep ownership, contact info, and decisions up to date">
        <form className="space-y-4" onSubmit={handleCrmSave}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-phone">
                Phone
              </label>
              <input
                id="crm-phone"
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="e.g., (555) 555-1212"
                disabled={updateCrm.isPending}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-address1">
                Address line 1
              </label>
              <input
                id="crm-address1"
                type="text"
                value={contactStreet1}
                onChange={(e) => setContactStreet1(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Street address"
                disabled={updateCrm.isPending}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-address2">
                Address line 2
              </label>
              <input
                id="crm-address2"
                type="text"
                value={contactStreet2}
                onChange={(e) => setContactStreet2(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Apt, unit, suite (optional)"
                disabled={updateCrm.isPending}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-city">
                  City
                </label>
                <input
                  id="crm-city"
                  type="text"
                  value={contactCity}
                  onChange={(e) => setContactCity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="City"
                  disabled={updateCrm.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-state">
                  State
                </label>
                <input
                  id="crm-state"
                  type="text"
                  value={contactStateCode}
                  onChange={(e) => setContactStateCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., TX"
                  disabled={updateCrm.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-postal">
                  Postal code
                </label>
                <input
                  id="crm-postal"
                  type="text"
                  value={contactPostalCode}
                  onChange={(e) => setContactPostalCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="ZIP"
                  disabled={updateCrm.isPending}
                />
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-assigned">
                Owner
              </label>
              <input
                id="crm-assigned"
                type="text"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Assigned teammate"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-followup">
                Follow-up
              </label>
              <input
                id="crm-followup"
                type="datetime-local"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                {FOLLOW_UP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyFollowUpPreset(preset)}
                    className="rounded-full border border-slate-300 px-2.5 py-1 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFollowUpAt('')}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-500 hover:border-rose-300 hover:text-rose-600"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="crm-qualification">
              Qualification notes
            </label>
            <textarea
              id="crm-qualification"
              value={qualificationNotes}
              onChange={(e) => setQualificationNotes(e.target.value)}
              rows={4}
              placeholder="Capture intake notes, screening details, or constraints"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Decision</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {[
                { value: 'pending', label: 'Pending' },
                { value: 'accepted', label: 'Accepted' },
                { value: 'denied', label: 'Denied' },
              ].map((option) => (
                <label key={option.value} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                  decision === option.value ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'
                }`}>
                  <input
                    type="radio"
                    name="crm-decision"
                    value={option.value}
                    checked={decision === option.value}
                    onChange={(e) => setDecision(e.target.value)}
                    className="h-3 w-3"
                  />
                  {option.label}
                </label>
              ))}
            </div>

            {decision === 'accepted' ? (
              <textarea
                value={acceptanceNotes}
                onChange={(e) => setAcceptanceNotes(e.target.value)}
                placeholder="Acceptance notes"
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            ) : null}

            {decision === 'accepted' && missingRequiredDocs.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Finish required checklist items before confirming acceptance:
                <ul className="mt-1 list-disc pl-4">
                  {missingRequiredDocs.map((doc) => (
                    <li key={doc.key || doc.label || doc.id}>{doc.label || doc.key || 'Checklist item'}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {decision === 'denied' ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={denialReason}
                  onChange={(e) => setDenialReason(e.target.value)}
                  placeholder="Denial reason"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <textarea
                  value={denialNotes}
                  onChange={(e) => setDenialNotes(e.target.value)}
                  placeholder="Additional notes"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            ) : null}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updateCrm.isPending}
              className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updateCrm.isPending ? 'Saving…' : 'Save CRM details'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Stage history" subtitle="Recent transitions and notes">
        <ul className="space-y-2 text-sm text-slate-600">
          {(Array.isArray(data.crm_stage_history) ? data.crm_stage_history : []).slice().reverse().map((entry, idx) => (
            <li key={`${entry.stage || 'stage'}-${idx}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{entry.actor || 'system'}</span>
                <span>{formatRelative(entry.changedAt)}</span>
              </div>
              <div className="text-sm font-medium text-slate-800">{stageLabel(entry.stage || '')}</div>
              {entry.note ? <div className="text-xs text-slate-500">{entry.note}</div> : null}
            </li>
          ))}
          {(Array.isArray(data.crm_stage_history) ? data.crm_stage_history : []).length === 0 ? (
            <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              No stage changes recorded yet.
            </li>
          ) : null}
        </ul>
      </SectionCard>
    </div>
  );

  const enrichmentContent = !providersLoaded ? (
    <SectionCard title="Enrichment" subtitle="Loading provider configuration…">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Checking available enrichment providers…</div>
    </SectionCard>
  ) : providerOptions.length === 0 ? (
    <SectionCard
      title="Enrichment"
      subtitle="Configure at least one enrichment provider to enable lookups."
    >
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Set the `ENRICHMENT_PROVIDERS` environment variable (for example `pipl,whitepages`),
        provide API keys, and restart the API server to begin enrichment.
      </div>
    </SectionCard>
  ) : (
    <div className="space-y-6">
      <SectionCard
        title={`${providerLabel} enrichment`}
        subtitle="Run a manual lookup to pull possible next-of-kin and contact details."
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="enrichment-provider">
                  Provider
                </label>
                <select
                  id="enrichment-provider"
                  value={selectedProviderId}
                  onChange={(event) => setSelectedProviderId(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col items-start gap-1 text-xs text-slate-500 md:items-end">
                <span>
                  Last run: {enrichmentDoc?.requestedAt ? formatRelative(enrichmentDoc.requestedAt) : 'Never'}
                </span>
                <span>
                  Requested by: {enrichmentDoc?.requestedBy?.email || enrichmentDoc?.requestedBy?.name || '—'}
                </span>
              </div>
            </div>
            {enrichmentData?.cached ? (
              <div className="mt-2 text-xs text-slate-500">
                Current results cached until {enrichmentNextRefresh ? formatRelative(enrichmentNextRefresh) : 'later'}.
                {supportsForce && canForceByRole ? ' Use force refresh to bypass the cache.' : ''}
              </div>
            ) : null}
            {enrichmentDoc?.error?.message ? (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {enrichmentDoc.error.message}
              </div>
            ) : null}
          </div>

          <form className="space-y-4" onSubmit={handleEnrichmentSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-first">
                  First name
                </label>
                <input
                  id="wp-first"
                  type="text"
                  value={currentEnrichmentInput.firstName || ''}
                  onChange={(event) => handleEnrichmentFieldChange('firstName', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., John"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-last">
                  Last name
                </label>
                <input
                  id="wp-last"
                  type="text"
                  value={currentEnrichmentInput.lastName || ''}
                  onChange={(event) => handleEnrichmentFieldChange('lastName', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., Doe"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-city">
                  City (optional)
                </label>
                <input
                  id="wp-city"
                  type="text"
                  value={currentEnrichmentInput.city || ''}
                  onChange={(event) => handleEnrichmentFieldChange('city', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., Houston"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-state">
                  State (optional)
                </label>
                <input
                  id="wp-state"
                  type="text"
                  value={currentEnrichmentInput.stateCode || ''}
                  onChange={(event) => handleEnrichmentFieldChange('stateCode', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., TX"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-postal">
                  Postal code (optional)
                </label>
                <input
                  id="wp-postal"
                  type="text"
                  value={currentEnrichmentInput.postalCode || ''}
                  onChange={(event) => handleEnrichmentFieldChange('postalCode', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., 77002"
                  disabled={runEnrichment.isPending}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="wp-phone">
                  Phone (optional)
                </label>
                <input
                  id="wp-phone"
                  type="text"
                  value={currentEnrichmentInput.phone || ''}
                  onChange={(event) => handleEnrichmentFieldChange('phone', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="e.g., (555) 555-1212"
                  disabled={runEnrichment.isPending}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!selectedProviderId || !canRunEnrichment || runEnrichment.isPending}
                className="inline-flex items-center rounded-lg border border-blue-500 bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500"
              >
                {runEnrichment.isPending ? 'Running…' : enrichmentDoc ? 'Run again' : 'Run enrichment'}
              </button>
              {supportsForce && canForceByRole ? (
                <button
                  type="button"
                  onClick={handleForceEnrichment}
                  disabled={runEnrichment.isPending}
                  className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Force refresh
                </button>
              ) : null}
              {!canRunEnrichment ? (
                <span className="text-xs text-slate-500">
                  You do not have permission to run enrichment for this case.
                </span>
              ) : null}
            </div>
          </form>
        </div>
      </SectionCard>

      <SectionCard title="Enrichment results" subtitle="Review matches and attach any relevant contacts">
        {enrichmentRefreshing ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
            Fetching results…
          </div>
        ) : !enrichmentDoc ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Run enrichment to pull candidate matches from {providerLabel}.
          </div>
        ) : (
          <div className="space-y-4">
            {enrichmentDoc.status === 'error' ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {enrichmentDoc.error?.message || 'Enrichment failed. Try again later.'}
              </div>
            ) : null}
            {enrichmentSelected.length ? (
              <div className="text-xs text-slate-500">
                Attached records: {enrichmentSelected.map((entry) => entry?.recordId).filter(Boolean).join(', ')}
              </div>
            ) : null}
            {enrichmentCandidates.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full table-auto border-collapse text-sm">
                  <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Phones</th>
                      <th className="px-3 py-2">Addresses</th>
                      <th className="px-3 py-2">Relations</th>
                      <th className="px-3 py-2" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {enrichmentCandidates.map((candidate, index) => {
                      const rowKey = candidate?.recordId || `${candidate?.fullName || 'candidate'}-${index}`;
                      const isSelected = candidate?.recordId && enrichmentSelectedSet.has(candidate.recordId);
                      return (
                        <tr key={rowKey} className="border-b border-slate-100">
                          <td className="px-3 py-3 align-top">
                            <div className="font-medium text-slate-800">{candidate?.fullName || 'Unknown'}</div>
                            <div className="text-xs text-slate-500">
                              {candidate?.ageRange ? `${candidate.ageRange}` : null}
                              {candidate?.gender ? ` ${candidate.gender}` : null}
                              {candidate?.recordId ? ` • ${candidate.recordId}` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {Array.isArray(candidate?.contacts) && candidate.contacts.length ? (
                              <ul className="space-y-1">
                                {candidate.contacts.map((contact, idx) => (
                                  <li key={`${rowKey}-phone-${idx}`}>
                                    <span>{contact.value}</span>
                                    {contact.lineType ? ` • ${contact.lineType}` : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {Array.isArray(candidate?.addresses) && candidate.addresses.length ? (
                              <ul className="space-y-1">
                                {candidate.addresses.map((address, idx) => (
                                  <li key={`${rowKey}-addr-${idx}`}>
                                    {[address.streetLine1, address.city, address.stateCode, address.postalCode]
                                      .filter(Boolean)
                                      .join(', ') || '—'}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600">
                            {Array.isArray(candidate?.relations) && candidate.relations.length ? (
                              <ul className="space-y-1">
                                {candidate.relations.map((relation, idx) => (
                                  <li key={`${rowKey}-rel-${idx}`}>
                                    {relation.name || 'Unnamed'}{relation.relation ? ` — ${relation.relation}` : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-right">
                            {candidate?.recordId ? (
                              <button
                                type="button"
                                onClick={() => handleSelectEnrichmentRecord(candidate.recordId)}
                                disabled={!canRunEnrichment || selectEnrichment.isPending || (selectingRecordId === candidate.recordId && selectEnrichment.isPending)}
                                className={`inline-flex items-center rounded-lg border px-3 py-1 text-xs font-medium transition ${
                                  isSelected
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                    : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                                } disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                {selectingRecordId === candidate.recordId && selectEnrichment.isPending
                                  ? 'Saving…'
                                  : isSelected
                                    ? 'Attached'
                                    : 'Attach'}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">No record id</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                No candidates were returned for the last search.
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Related parties" subtitle="Extracted relationships and their known contact info">
        {relatedPartiesLoading ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
            Loading related parties…
          </div>
        ) : relatedParties.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full table-auto border-collapse text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Phones</th>
                  <th className="px-3 py-2">Emails</th>
                  <th className="px-3 py-2">Addresses</th>
                  <th className="px-3 py-2">Accepted</th>
                  <th className="px-3 py-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {relatedParties.map((party, index) => {
                  const rowKey = party?.partyId || `${party?.name || 'party'}-${index}`;
                  const scorePct = typeof party?.lastAudit?.match === 'number'
                    ? `${Math.round(party.lastAudit.match * 100)}%`
                    : '—';
                  const isReEnriching = reEnrichingPartyId === party?.partyId && reEnrichParty.isPending;
                  return (
                    <tr key={rowKey} className="border-b border-slate-100">
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-slate-800">{party?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{party?.relationLabel || party?.relationType || ''}</div>
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-slate-600">{scorePct}</td>
                      <td className="px-3 py-3 align-top text-xs text-slate-600">
                        {party?.contacts?.phones?.length ? (
                          <ul className="space-y-1">
                            {party.contacts.phones.map((phone, idx) => (
                              <li key={`${rowKey}-phone-${idx}`}>{phone}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-slate-600">
                        {party?.contacts?.emails?.length ? (
                          <ul className="space-y-1">
                            {party.contacts.emails.map((email, idx) => (
                              <li key={`${rowKey}-email-${idx}`}>{email}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-slate-600">
                        {party?.addresses?.length ? (
                          <ul className="space-y-1">
                            {party.addresses.map((address, idx) => (
                              <li key={`${rowKey}-addr-${idx}`}>{address}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-slate-600">
                        {party?.lastAudit ? (party.lastAudit.accepted ? 'Yes' : 'No') : '—'}
                      </td>
                      <td className="px-3 py-3 align-top text-right">
                        <button
                          type="button"
                          onClick={() => handleReEnrichParty(party)}
                          disabled={!canRunEnrichment || isReEnriching}
                          className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isReEnriching ? 'Re-enriching…' : 'Re-enrich'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            No related parties found for this subject.
          </div>
        )}
      </SectionCard>
    </div>
  );

  const documentsContent = (
    <SectionCard title="Documents" subtitle="Upload and manage supporting files">
      {attachments.length ? (
        <ul className="space-y-2">
          {attachments.map((file, idx) => {
            const attachmentId = file.id || '';
            const isEditing = editingAttachmentId === attachmentId;
            const isDeleting = deletingAttachmentId === attachmentId;
            const updatePending = updateAttachment.isPending && isEditing;
            const deletePending = deleteAttachment.isPending && isDeleting;

            return (
              <li
                key={attachmentId || file.filename || file.url || idx}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium text-slate-800">{file.label || file.originalName || file.filename || `Attachment ${idx + 1}`}</div>
                    <div className="text-xs text-slate-500">
                      {formatRelative(file.uploadedAt)} • {formatFileSize(file.size)} • {file.mimeType || 'unknown type'}
                    </div>
                    {file.note ? <div className="text-xs text-slate-500">{file.note}</div> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {file.checklistKey ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                        Linked: {file.checklistKey.replace(/_/g, ' ')}
                      </span>
                    ) : null}
                    {file.url ? (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-blue-700 hover:bg-blue-100"
                      >
                        View
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => (isEditing ? cancelAttachmentEdit() : startAttachmentEdit(file))}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={(updateAttachment.isPending && !isEditing) || deleteAttachment.isPending}
                    >
                      {isEditing ? 'Cancel' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAttachmentDelete(file)}
                      className="rounded-lg border border-rose-300 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={deletePending || updateAttachment.isPending}
                    >
                      {deletePending ? 'Removing…' : 'Delete'}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <form onSubmit={handleAttachmentSave} className="mt-2 space-y-2 text-xs">
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="flex flex-col">
                        <span className="font-semibold uppercase tracking-wide text-slate-500">Label</span>
                        <input
                          type="text"
                          value={attachmentLabel}
                          onChange={(e) => setAttachmentLabel(e.target.value)}
                          className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={updatePending}
                          placeholder="Document label"
                        />
                      </label>
                      <label className="flex flex-col">
                        <span className="font-semibold uppercase tracking-wide text-slate-500">Checklist link</span>
                        <select
                          value={attachmentChecklist}
                          onChange={(e) => setAttachmentChecklist(e.target.value)}
                          className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={updatePending}
                        >
                          <option value="">Not linked</option>
                          {checklistItems.map((item) => (
                            <option key={item.key || item.label} value={item.key || item.label || ''}>
                              {item.label || item.key || 'Checklist item'}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="flex flex-col">
                      <span className="font-semibold uppercase tracking-wide text-slate-500">Internal note</span>
                      <textarea
                        value={attachmentNote}
                        onChange={(e) => setAttachmentNote(e.target.value)}
                        rows={2}
                        className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={updatePending}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={updatePending}
                      >
                        {updatePending ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelAttachmentEdit}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={updatePending}
                      >
                        Close
                      </button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          No documents attached yet.
        </div>
      )}

      <form
        onSubmit={handleDocumentUpload}
        className="mt-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
      >
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="w-full text-sm"
            disabled={uploadDocument.isPending}
          />
          <input
            type="text"
            value={uploadLabel}
            onChange={(e) => setUploadLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploadDocument.isPending}
          />
          <textarea
            value={uploadNote}
            onChange={(e) => setUploadNote(e.target.value)}
            rows={2}
            placeholder="Internal note (optional)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploadDocument.isPending}
          />
        </div>
        <div className="space-y-2">
          <select
            value={uploadChecklistKey}
            onChange={(e) => setUploadChecklistKey(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploadDocument.isPending}
          >
            <option value="">Link to checklist (optional)</option>
            {checklistItems.map((item) => (
              <option key={item.key || item.label} value={item.key || item.label || ''}>
                {item.label || item.key || 'Checklist item'}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={uploadDocument.isPending}
            className="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploadDocument.isPending ? 'Uploading…' : 'Upload document'}
          </button>
        </div>
      </form>
    </SectionCard>
  );

  const checkinsContent = (
    <SectionCard
      title="Scheduled check-ins"
      subtitle={`${caseCheckins.length} record${caseCheckins.length === 1 ? '' : 's'}`}
    >
      {caseCheckins.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          No check-ins scheduled for this case yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Due at</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Officer</th>
                <th className="px-4 py-3">GPS</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm text-slate-700">
              {caseCheckins.map((checkIn) => (
                <tr key={checkIn.id || checkIn._id}>
                  <td className="px-4 py-3">
                    {checkIn.dueAt ? new Date(checkIn.dueAt).toLocaleString() : '—'}
                    {checkIn.timezone ? (
                      <div className="text-xs text-slate-400">{checkIn.timezone}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        checkIn.status === 'done'
                          ? 'bg-emerald-50 text-emerald-700'
                          : checkIn.status === 'overdue'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {checkIn.status || 'pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{checkIn.meta?.officerName || '—'}</td>
                  <td className="px-4 py-3">
                    {checkIn.gpsEnabled ? (
                      <div className="space-y-1">
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          Enabled
                        </span>
                        <div className="text-[11px] text-slate-400">{checkIn.pingsPerDay} ping(s)/day</div>
                        {checkIn.lastPingAt ? (
                          <div className="text-[11px] text-slate-400">
                            Last ping {formatRelative(checkIn.lastPingAt)}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{checkIn.note || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {checkIn.gpsEnabled ? (
                      <button
                        type="button"
                        onClick={() => queuePingForCheckIn(checkIn.id)}
                        disabled={triggerPing.isPending}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {triggerPing.isPending ? 'Pinging…' : 'Ping now'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );

  const communicationsContent = (
    <SectionCard
      title="Communications"
      subtitle={messagesLoading ? 'Loading messages…' : `${messageCount} message${messageCount === 1 ? '' : 's'}`}
    >
      {messagesError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load messages.
        </div>
      ) : messagesLoading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          Loading communications…
        </div>
      ) : messageCount === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          No messages logged for this case yet.
        </div>
      ) : (
        <div className="space-y-3">
          {messageItems.map((msg) => (
            <article key={msg._id || msg.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{msg.direction?.toUpperCase() || '—'}</span>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{msg.channel?.toUpperCase() || '—'}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 ${
                      msg.status === 'failed'
                        ? 'bg-rose-50 text-rose-700'
                        : msg.status === 'queued'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {msg.status || 'unknown'}
                  </span>
                </div>
                <div className="text-xs text-slate-500">{formatRelative(msg.sentAt || msg.deliveredAt || msg.createdAt)}</div>
              </div>
              {msg.body ? <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{msg.body}</p> : null}
              {msg.status === 'failed' && (msg.errorMessage || msg.errorCode) ? (
                <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {(msg.errorMessage || '').trim() || 'Delivery failed.'}
                  {msg.errorCode ? <span className="ml-2 font-mono">[{msg.errorCode}]</span> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!caseId || !msg.id) return;
                        resendMessage.mutate({ caseId, messageId: msg.id });
                      }}
                      disabled={resendMessage.isPending}
                      className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resendMessage.isPending ? 'Retrying…' : 'Retry message'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/messages?compose=retry&case=${caseId}&message=${msg.id || ''}`)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                    >
                      Edit & resend
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );

  const activityContent = (
    <SectionCard
      title="Activity"
      subtitle={activityLoading
        ? 'Loading activity…'
        : createActivity.isPending
          ? 'Logging activity…'
          : `${activityCount} event${activityCount === 1 ? '' : 's'}`}
    >
      <form
        onSubmit={handleActivitySubmit}
        className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            {ACTIVITY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyActivityPreset(preset.id)}
                className={`rounded-full border px-2.5 py-1 ${
                  activityPreset === preset.id
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-300 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setActivityPreset('');
                setActivityOutcome('');
                setActivityNote('');
                setActivityFollowUp('');
              }}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-500 hover:border-rose-300 hover:text-rose-600"
            >
              Clear preset
            </button>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="activity-note">
            Note
          </label>
          <textarea
            id="activity-note"
            value={activityNote}
            onChange={(e) => setActivityNote(e.target.value)}
            rows={3}
            placeholder="Log a call, meeting, or internal observation"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={createActivity.isPending}
          />
        </div>
        <div className="grid gap-2">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="activity-outcome">
              Outcome (optional)
            </label>
            <input
              id="activity-outcome"
              type="text"
              value={activityOutcome}
              onChange={(e) => setActivityOutcome(e.target.value)}
              placeholder="e.g., Left voicemail, Completed intake"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={createActivity.isPending}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="activity-followup">
              Follow-up (optional)
            </label>
            <input
              id="activity-followup"
              type="datetime-local"
              value={activityFollowUp}
              onChange={(e) => setActivityFollowUp(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={createActivity.isPending}
            />
          </div>
          <button
            type="submit"
            disabled={createActivity.isPending}
            className="mt-auto rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createActivity.isPending ? 'Saving…' : 'Log activity'}
          </button>
        </div>
      </form>

      {activityError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load activity.
        </div>
      ) : activityLoading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          Loading activity…
        </div>
      ) : activityCount === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
          No recent activity to display.
        </div>
      ) : (
        <ul className="space-y-3">
          {activityEvents.map((event, idx) => {
            // Parse enrichment audit details if present
            let enrichmentDetails = null;
            if (event.type && event.type.startsWith('enrichment_')) {
              try {
                let details = event.details;
                if (typeof details === 'string') {
                  details = JSON.parse(details);
                }
                enrichmentDetails = details;
              } catch (e) {
                console.warn(`Failed to parse enrichment details for event ${idx}:`, e);
              }
            }

            return (
              <li key={`${event.type || 'event'}-${idx}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-900">{event.title}</div>
                    
                    {/* Enrichment-specific details */}
                    {enrichmentDetails ? (
                      <div className="mt-3 space-y-3 text-xs text-slate-600">
                        <div><span className="font-medium">Status:</span> {enrichmentDetails.status || 'unknown'} (HTTP {enrichmentDetails.httpStatus || '?'})</div>
                        <div><span className="font-medium">Candidates:</span> {enrichmentDetails.candidateCount || 0}</div>
                        
                        {/* Error block if present */}
                        {enrichmentDetails.error ? (
                          <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-rose-700">
                            <div className="font-medium">{enrichmentDetails.error.code}</div>
                            <div>{enrichmentDetails.error.message}</div>
                          </div>
                        ) : null}
                        
                        {/* JSON Response Accordion */}
                        {enrichmentDetails.enrichmentResult && (
                          <div className="border-2 border-blue-500 rounded-lg bg-blue-50 overflow-hidden mt-3">
                            <button
                              type="button"
                              onClick={() => setExpandedActivityDetails(prev => ({ ...prev, [idx]: !prev[idx] }))}
                              className="w-full text-left cursor-pointer p-4 font-bold text-blue-900 hover:bg-blue-100 select-none flex items-center gap-3"
                            >
                              <span className="inline-block text-lg">{expandedActivityDetails[idx] ? 'v' : '>'}</span>
                              <span>RESPONSE JSON</span>
                            </button>
                            {expandedActivityDetails[idx] && (
                              <div className="max-h-96 overflow-auto border-t-2 border-blue-500 bg-white">
                                <pre className="p-4 text-[9px] leading-tight text-slate-700 font-mono whitespace-pre-wrap break-words">
                                  {enrichmentDetails.enrichmentResult}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Search Parameters Accordion */}
                        {enrichmentDetails.params && (
                          <div className="border-2 border-green-500 rounded-lg bg-green-50 overflow-hidden mt-2">
                            <button
                              type="button"
                              onClick={() => setExpandedActivityDetails(prev => ({ ...prev, [`params-${idx}`]: !prev[`params-${idx}`] }))}
                              className="w-full text-left cursor-pointer p-4 font-bold text-green-900 hover:bg-green-100 select-none flex items-center gap-3"
                            >
                              <span className="inline-block text-lg">{expandedActivityDetails[`params-${idx}`] ? 'v' : '>'}</span>
                              <span>SEARCH PARAMETERS</span>
                            </button>
                            {expandedActivityDetails[`params-${idx}`] && (
                              <div className="max-h-96 overflow-auto border-t-2 border-green-500 bg-white">
                                <pre className="p-4 text-[9px] leading-tight text-slate-700 font-mono whitespace-pre-wrap break-words">
                                  {enrichmentDetails.params}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : event.details ? (
                      <div className="text-xs text-slate-500 break-words mt-2">{event.details}</div>
                    ) : null}
                    
                    {event.actor ? <div className="text-[11px] text-slate-400 mt-2">By {event.actor}</div> : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-xs text-slate-500">{formatRelative(event.occurredAt)}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );

  let activeContent = overviewContent;
  if (activeTab === 'checkins') activeContent = checkinsContent;
  else if (activeTab === 'checklist') activeContent = checklistContent;
  else if (activeTab === 'crm') activeContent = crmContent;
  else if (activeTab === 'enrichment') activeContent = (
    <div className="space-y-6">
      {data?.county?.toLowerCase() === 'harris' && data?.spn && (
        <HarrisSheriffVerificationPanel spn={data.spn} />
      )}
      {enrichmentContent}
    </div>
  );
  else if (activeTab === 'documents') activeContent = documentsContent;
  else if (activeTab === 'communications') activeContent = communicationsContent;
  else if (activeTab === 'activity') activeContent = activityContent;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        {data.mugshotUrl ? (
          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200">
            <img
              src={data.mugshotUrl}
              alt=""
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}
        <div className="flex-1">
      <PageHeader
        title={data.full_name || 'Case detail'}
        subtitle={headerSubtitle}
        actions={(
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePingNow}
              disabled={triggerPing.isPending}
              className="rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {triggerPing.isPending ? 'Pinging…' : 'Ping now'}
            </button>
            <button
              type="button"
              onClick={handleMessageCase}
              className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Message client
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:border-blue-300"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400"
            >
              Back
            </button>
          </div>
        )}
      />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Boolean(data?.needs_attention) && Array.isArray(data?.attention_reasons) && data.attention_reasons.length > 0 ? (
          <div className="mr-2 flex flex-wrap gap-2">
            {data.attention_reasons.map((r) => (
              <span key={`ar-${r}`} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                ⚠ {String(r).replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        ) : null}
        {manualTags.length ? (
          <div className="mr-2 hidden flex-wrap gap-2 sm:flex">
            {manualTags.map((t) => (
              <span key={`mt-${t}`} className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {t.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeContent}
    </div>
  );
}

function StatTile({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function DetailItem({ label, value, children }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children ? children : <div className="mt-1 text-sm text-slate-800">{value}</div>}
    </div>
  );
}
