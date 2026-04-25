import { useQuery } from '@tanstack/react-query';
import { getJSON } from './dashboard';

// Expected backend shape: {
//   totalProspects7d: number,
//   enrichedCount: number,
//   textedCount: number,
//   respondedCount: number,
//   generatedAt?: timestamp
// }
export function useProspectReport({ staleTime = 60_000 } = {}) {
  return useQuery({
    queryKey: ['prospect-report-7d'],
    queryFn: async () => getJSON('/reports/prospects7d'),
    staleTime,
  });
}
