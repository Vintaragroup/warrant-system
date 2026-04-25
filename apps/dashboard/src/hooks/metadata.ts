import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJSON } from './dashboard';

export interface AccessMetadata {
  counties: string[];
  departments: string[];
  roles: string[];
}

const FALLBACK_METADATA: AccessMetadata = Object.freeze({
  counties: ['brazoria', 'fortbend', 'galveston', 'harris', 'jefferson'],
  departments: [],
  roles: ['SuperUser', 'Admin', 'DepartmentLead', 'Employee', 'Sales', 'BondClient'],
});

function sanitizeList(value: unknown, fallback: string[]): string[] {
  if (!value) return fallback;
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return cleaned.length ? cleaned : fallback;
  }
  if (typeof value === 'string') {
    const cleaned = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned : fallback;
  }
  return fallback;
}

function sanitizeMetadata(raw: unknown): AccessMetadata {
  if (!raw || typeof raw !== 'object') return FALLBACK_METADATA;
  const data = raw as Record<string, unknown>;
  const counties = sanitizeList(data.counties, FALLBACK_METADATA.counties);
  const departments = sanitizeList(data.departments, FALLBACK_METADATA.departments);
  const roles = sanitizeList(data.roles, FALLBACK_METADATA.roles);
  return {
    counties,
    departments,
    roles,
  };
}

export function useMetadata() {
  return useQuery({
    queryKey: ['metadata'],
    queryFn: async () => {
      const response = await getJSON('/metadata');
      return sanitizeMetadata(response);
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useMetadataWithFallback() {
  const query = useMetadata();
  const metadata = useMemo<AccessMetadata>(() => {
    return query.data ?? FALLBACK_METADATA;
  }, [query.data]);

  return {
    ...query,
    metadata,
  };
}

export { FALLBACK_METADATA };
