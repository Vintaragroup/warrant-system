import { useQuery, useMutation } from '@tanstack/react-query';
import { getJSON, sendJSON, sendFormData } from './dashboard';

function buildCasesQuery(params = {}) {
  const qs = new URLSearchParams();
  if (params.query) qs.set('query', params.query);
  if (params.county) qs.set('county', params.county);
  if (params.status) qs.set('status', params.status);
  if (params.attention) qs.set('attention', 'true');
  if (params.attentionType) qs.set('attentionType', params.attentionType);
  if (params.noCount) qs.set('noCount', 'true');
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.sortBy) qs.set('sortBy', params.sortBy);
  if (params.order) qs.set('order', params.order);
  if (params.startDate) qs.set('startDate', params.startDate);
  if (params.endDate) qs.set('endDate', params.endDate);
  if (params.window) qs.set('window', params.window);
  if (params.minBond != null && params.minBond !== '') qs.set('minBond', String(params.minBond));
  if (params.maxBond != null && params.maxBond !== '') qs.set('maxBond', String(params.maxBond));
  if (params.stage) qs.set('stage', params.stage);
  if (params.county) qs.set('county', params.county);
  return qs.toString();
}

export function useCases(filters = {}, options = {}) {
  const queryString = buildCasesQuery(filters);
  return useQuery({
    queryKey: ['cases', queryString],
    queryFn: () => getJSON(`/cases${queryString ? `?${queryString}` : ''}`),
    staleTime: 30_000,
    ...options,
  });
}

export function useCaseMeta(options = {}) {
  return useQuery({
    queryKey: ['caseMeta'],
    queryFn: () => getJSON('/cases/meta'),
    staleTime: 300_000,
    ...options,
  });
}

export function useCase(caseId, options = {}) {
  return useQuery({
    queryKey: ['case', caseId],
    enabled: Boolean(caseId),
    queryFn: () => getJSON(`/cases/${encodeURIComponent(caseId)}`),
    staleTime: 60_000,
    ...options,
  });
}

export function useCaseByNumber(caseNumber, options = {}) {
  return useQuery({
    queryKey: ['caseByNumber', caseNumber],
    enabled: Boolean(caseNumber),
    queryFn: () => getJSON(`/cases/by-case-number/${encodeURIComponent(caseNumber)}`),
    staleTime: 60_000,
    ...options,
  });
}

export function useCaseStats(options = {}) {
  return useQuery({
    queryKey: ['caseStats'],
    queryFn: () => getJSON('/cases/stats'),
    staleTime: 60_000,
    ...options,
  });
}

export function useCasesTimeline({ days = 30, ...options } = {}) {
  const clamped = Math.min(Math.max(Number(days) || 30, 1), 60);
  return useQuery({
    queryKey: ['caseStats', 'timeline', clamped],
    queryFn: () => getJSON(`/dashboard/trends?days=${clamped}`),
    staleTime: 60_000,
    ...options,
  });
}

export function useUpdateCaseTags(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, tags }) =>
      sendJSON(`/cases/${encodeURIComponent(caseId)}/tags`, {
        method: 'PATCH',
        body: { tags },
      }),
    ...options,
  });
}

export function useCaseMessages(caseId, options = {}) {
  return useQuery({
    queryKey: ['caseMessages', caseId],
    enabled: Boolean(caseId),
    queryFn: () => getJSON(`/cases/${encodeURIComponent(caseId)}/messages`),
    staleTime: 30_000,
    ...options,
  });
}

export function useCaseActivity(caseId, options = {}) {
  return useQuery({
    queryKey: ['caseActivity', caseId],
    enabled: Boolean(caseId),
    queryFn: () => getJSON(`/cases/${encodeURIComponent(caseId)}/activity`),
    staleTime: 60_000,
    ...options,
  });
}

export function useResendMessage(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, messageId }) =>
      sendJSON(`/cases/${encodeURIComponent(caseId)}/messages/${encodeURIComponent(messageId)}/resend`, {
        method: 'POST',
      }),
    ...options,
  });
}

export function useUpdateCaseStage(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, stage, note }) =>
      sendJSON(`/cases/${encodeURIComponent(caseId)}/stage`, {
        method: 'PATCH',
        body: { stage, note },
      }),
    ...options,
  });
}

export function useUpdateCaseCrm(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, payload }) =>
      sendJSON(`/cases/${encodeURIComponent(caseId)}/crm`, {
        method: 'PATCH',
        body: payload,
      }),
    ...options,
  });
}

export function useUploadCaseDocument(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, file, label, note, checklistKey }) => {
      if (!file) throw new Error('file is required');
      const formData = new FormData();
      formData.append('file', file);
      if (label) formData.append('label', label);
      if (note) formData.append('note', note);
      if (checklistKey) formData.append('checklistKey', checklistKey);
      return sendFormData(`/cases/${encodeURIComponent(caseId)}/documents`, {
        formData,
      });
    },
    ...options,
  });
}

export function useUpdateCaseDocument(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, attachmentId, payload }) => {
      if (!caseId) throw new Error('caseId is required');
      if (!attachmentId) throw new Error('attachmentId is required');
      return sendJSON(
        `/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(attachmentId)}`,
        {
          method: 'PATCH',
          body: payload,
        }
      );
    },
    ...options,
  });
}

export function useDeleteCaseDocument(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, attachmentId }) => {
      if (!caseId) throw new Error('caseId is required');
      if (!attachmentId) throw new Error('attachmentId is required');
      return sendJSON(
        `/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(attachmentId)}`,
        {
          method: 'DELETE',
        }
      );
    },
    ...options,
  });
}

export function useCreateCaseActivity(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, payload }) =>
      sendJSON(`/cases/${encodeURIComponent(caseId)}/activity`, {
        method: 'POST',
        body: payload,
      }),
    ...options,
  });
}

export function useEnrichmentProviders(options = {}) {
  return useQuery({
    queryKey: ['enrichmentProviders'],
    queryFn: () => getJSON('/cases/enrichment/providers'),
    staleTime: 300_000,
    ...options,
  });
}

export function useCaseEnrichment(caseId, providerId, options = {}) {
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: ['caseEnrichment', providerId, caseId],
    enabled: Boolean(caseId) && Boolean(providerId) && enabled,
    queryFn: () => getJSON(`/cases/${encodeURIComponent(caseId)}/enrichment/${encodeURIComponent(providerId)}`),
    staleTime: 60_000,
    ...rest,
  });
}

export function useRunCaseEnrichment(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, providerId, payload }) => {
      if (!caseId) throw new Error('caseId is required');
      if (!providerId) throw new Error('providerId is required');
      return sendJSON(`/cases/${encodeURIComponent(caseId)}/enrichment/${encodeURIComponent(providerId)}`, {
        method: 'POST',
        body: payload,
      });
    },
    ...options,
  });
}

export function useSelectCaseEnrichment(options = {}) {
  return useMutation({
    mutationFn: ({ caseId, providerId, recordId }) => {
      if (!caseId) throw new Error('caseId is required');
      if (!providerId) throw new Error('providerId is required');
      if (!recordId) throw new Error('recordId is required');
      return sendJSON(`/cases/${encodeURIComponent(caseId)}/enrichment/${encodeURIComponent(providerId)}/select`, {
        method: 'POST',
        body: { recordId },
      });
    },
    ...options,
  });
}

// ── Harris Sheriff enrichment ─────────────────────────────────────────────────

/**
 * Fetches the stored harris_sheriff_enrichments document for an SPN.
 * The SPN is expected to be an 8-digit zero-padded string.
 */
export function useHarrisSheriffEnrichment(spn, options = {}) {
  const { enabled = true, ...rest } = options;
  const paddedSpn = spn ? String(spn).replace(/\D/g, '').padStart(8, '0') : null;
  return useQuery({
    queryKey: ['harrisSheriffEnrichment', paddedSpn],
    queryFn: () => getJSON(`/admin/ingestion/enrichment/harris-sheriff/${paddedSpn}`),
    enabled: Boolean(paddedSpn) && paddedSpn !== '00000000' && enabled,
    staleTime: 60_000,
    ...rest,
  });
}

/**
 * Mutation that triggers a single-SPN enrichment via the admin API.
 * Call with: mutateAsync({ spn: '03334984', dry_run: false })
 */
export function useRunHarrisSheriffEnrichment(options = {}) {
  return useMutation({
    mutationFn: ({ spn, dry_run = false }) => {
      if (!spn) throw new Error('spn is required');
      return sendJSON('/admin/ingestion/enrich/harris-sheriff', {
        method: 'POST',
        body: { spn, dry_run },
      });
    },
    ...options,
  });
}

