import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard';

export function useCallQueue({ status = 'pending', limit = 100 } = {}, options = {}) {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (limit != null) qs.set('limit', String(limit));
  const queryString = qs.toString();

  return useQuery({
    queryKey: ['call-queue', queryString],
    queryFn: async () => {
      const data = await getJSON(`/call-queue${queryString ? `?${queryString}` : ''}`);
      return data?.items ?? [];
    },
    staleTime: 10_000,
    ...options,
  });
}

export function useCallQueueActivity({ limit = 50 } = {}, options = {}) {
  const qs = new URLSearchParams();
  if (limit != null) qs.set('limit', String(limit));
  const queryString = qs.toString();

  return useQuery({
    queryKey: ['call-queue-activity', queryString],
    queryFn: async () => {
      const data = await getJSON(`/call-queue/activity${queryString ? `?${queryString}` : ''}`);
      return data?.items ?? [];
    },
    staleTime: 15_000,
    ...options,
  });
}

export function useUpdateCallQueueEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, notes }) => {
      if (!id) throw new Error('id is required');
      const body = {};
      if (status) body.status = status;
      if (notes != null) body.notes = notes;
      return sendJSON(`/call-queue/${id}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['call-queue'] });
      qc.invalidateQueries({ queryKey: ['call-queue-activity'] });
    },
  });
}

export function useNotifyCallQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageOverride } = {}) => {
      return sendJSON('/call-queue/notify', { method: 'POST', body: messageOverride ? { messageOverride } : {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['call-queue-activity'] });
    },
  });
}
