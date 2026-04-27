import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard';

export function useIngestionStatus(options = {}) {
  return useQuery({
    queryKey: ['ingestion', 'status'],
    queryFn: () => getJSON('/admin/ingestion/status'),
    staleTime: 30_000,
    ...options,
  });
}

export function useIngestionRuns({ source = '', limit = 50 } = {}, options = {}) {
  const qs = new URLSearchParams();
  if (source) qs.set('source', source);
  if (limit) qs.set('limit', String(limit));
  const search = qs.toString();
  return useQuery({
    queryKey: ['ingestion', 'runs', source, limit],
    queryFn: () => getJSON(`/admin/ingestion/runs${search ? `?${search}` : ''}`),
    staleTime: 30_000,
    ...options,
  });
}

export function useIngestionErrors({ source = '', limit = 50 } = {}, options = {}) {
  const qs = new URLSearchParams();
  if (source) qs.set('source', source);
  if (limit) qs.set('limit', String(limit));
  const search = qs.toString();
  return useQuery({
    queryKey: ['ingestion', 'errors', source, limit],
    queryFn: () => getJSON(`/admin/ingestion/errors${search ? `?${search}` : ''}`),
    staleTime: 30_000,
    ...options,
  });
}

export function useIngestionConfig({ source = '' } = {}, options = {}) {
  const qs = source ? `?source=${encodeURIComponent(source)}` : '';
  return useQuery({
    queryKey: ['ingestion', 'config', source],
    queryFn: () => getJSON(`/admin/ingestion/config${qs}`),
    staleTime: 60_000,
    ...options,
  });
}

export function useUpdateIngestionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => sendJSON('/admin/ingestion/config', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingestion'] }),
  });
}

export function useTriggerRun() {
  return useMutation({
    mutationFn: (body) => sendJSON('/admin/ingestion/run', { method: 'POST', body }),
  });
}

export function usePauseSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source) =>
      sendJSON(`/admin/ingestion/schedules/${encodeURIComponent(source)}/pause`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingestion'] }),
  });
}

export function useResumeSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source) =>
      sendJSON(`/admin/ingestion/schedules/${encodeURIComponent(source)}/resume`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingestion'] }),
  });
}
