import { useQuery, useMutation } from '@tanstack/react-query';
import { getJSON, sendJSON, sendFormData } from './dashboard';

function buildCasesQuery(params = {}) {
  const qs = new URLSearchParams();
  if (params.query) qs.set('query', params.query);
  if (params.county) qs.set('county', params.county);
  if (params.status) qs.set('status', params.status);
  if (params.attention) qs.set('attention', 'true');
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.sortBy) qs.set('sortBy', params.sortBy);
  if (params.order) qs.set('order', params.order);
  if (params.startDate) qs.set('startDate', params.startDate);
  if (params.endDate) qs.set('endDate', params.endDate);
  if (params.minBond != null && params.minBond !== '') qs.set('minBond', String(params.minBond));
  if (params.maxBond != null && params.maxBond !== '') qs.set('maxBond', String(params.maxBond));
  if (params.stage) qs.set('stage', params.stage);
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
