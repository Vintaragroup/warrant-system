import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard.js';

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  if (params.caseId) search.set('caseId', params.caseId);
  if (params.limit) search.set('limit', String(params.limit));
  return search.toString();
}

export function useMessages(params = {}) {
  const queryKey = ['messages', params];
  const queryFn = async () => {
    const qs = buildQuery(params);
    const suffix = qs ? `?${qs}` : '';
    const data = await getJSON(`/messages${suffix}`);
    return data?.items ?? [];
  };

  return useQuery({
    queryKey,
    queryFn,
    staleTime: 10_000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, to, body }) => {
      const payload = { caseId, to, body };
      const res = await sendJSON('/messages/send', { method: 'POST', body: payload });
      return res;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      if (variables?.caseId) {
        qc.invalidateQueries({ queryKey: ['messages', { caseId: variables.caseId }] });
      }
    },
  });
}
