import { useQuery } from '@tanstack/react-query';
import { getJSON } from './dashboard';

export function useTelnyxStatus(options = {}) {
  return useQuery({
    queryKey: ['telnyx', 'status'],
    queryFn: () => getJSON('/admin/telnyx/status'),
    staleTime: 30_000,
    ...options,
  });
}
