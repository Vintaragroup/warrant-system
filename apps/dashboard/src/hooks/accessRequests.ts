import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard';

type AccessRequestStatus = 'pending' | 'reviewed' | 'completed' | 'rejected';

type AccessRequest = {
  id: string;
  email: string;
  displayName?: string;
  message?: string;
  status: AccessRequestStatus;
  createdAt?: string;
  updatedAt?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
};

export function useAccessRequests(status: AccessRequestStatus | 'all' = 'pending') {
  const params = new URLSearchParams();
  if (status && status !== 'all') {
    params.set('status', status);
  }
  const qs = params.toString();

  return useQuery({
    queryKey: ['accessRequests', status],
    queryFn: async () => {
      const result = await getJSON(`/access-requests${qs ? `?${qs}` : ''}`);
      return Array.isArray(result?.requests) ? (result.requests as AccessRequest[]) : [];
    },
    staleTime: 30_000,
  });
}

export function useUpdateAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AccessRequestStatus }) => {
      const result = await sendJSON(`/access-requests/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { status },
      });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] });
    },
  });
}

export type { AccessRequest, AccessRequestStatus };
