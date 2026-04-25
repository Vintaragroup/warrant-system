import { useQuery } from '@tanstack/react-query';
import { getJSON } from './dashboard';

// Proxied through UI backend: /api/enrichment/prospects_window
// Server proxy forwards to ENRICHMENT_API_URL/api/enrichment/prospects_window
export function useProspects({ windowHours = 24, minBond = undefined, limit = 200, county, attention } = {}, options = {}) {
  const qs = new URLSearchParams();
  qs.set('windowHours', String(windowHours));
  // Only include minBond if provided; otherwise let the API apply its default threshold
  if (minBond != null) qs.set('minBond', String(minBond));
  if (limit != null) qs.set('limit', String(limit));
  if (county) qs.set('county', String(county));
  if (attention) qs.set('attention', 'true');
  const queryString = qs.toString();

  return useQuery({
    queryKey: ['prospects', queryString],
    queryFn: async () => {
      const raw = await getJSON(`/enrichment/prospects_window?${queryString}`);
      // Normalize shape: prefer items, otherwise map rows -> items
      if (Array.isArray(raw?.items)) return raw;
      if (Array.isArray(raw?.rows)) {
        return { ...raw, items: raw.rows };
      }
      return raw;
    },
    staleTime: 60_000,
    ...options,
  });
}
