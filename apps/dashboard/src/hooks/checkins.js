import { useQuery, useMutation } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard';

function buildQueryString(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useCheckins(filters = { scope: 'today' }, options = {}) {
  const normalized = typeof filters === 'string' ? { scope: filters } : filters;
  const queryString = buildQueryString({ scope: 'today', ...normalized });
  return useQuery({
    queryKey: ['checkins', queryString],
    queryFn: () => getJSON(`/checkins${queryString}`),
    staleTime: 30_000,
    ...options,
  });
}

export function useUpdateCheckinStatus(options = {}) {
  return useMutation({
    mutationFn: ({ id, status, note }) =>
      sendJSON(`/checkins/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: { status, note },
      }),
    ...options,
  });
}

export function useCheckInOptions(options = {}) {
  return useQuery({
    queryKey: ['checkins', 'options'],
    queryFn: async () => {
      const data = await getJSON('/checkins/options');
      const clients = Array.isArray(data?.clients) ? data.clients : [];
      const officers = Array.isArray(data?.officers) ? data.officers : [];
      const defaults = data?.defaults && typeof data.defaults === 'object' ? data.defaults : {};
      return { clients, officers, defaults };
    },
    staleTime: 60_000,
    ...options,
  });
}

export function useLogCheckinContact(options = {}) {
  return useMutation({
    mutationFn: ({ id, increment = 1 }) =>
      sendJSON(`/checkins/${encodeURIComponent(id)}/contact`, {
        method: 'PATCH',
        body: { increment },
      }),
    ...options,
  });
}

export function useCheckInDetail(id, options = {}) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ['checkins', 'detail', id],
    queryFn: () => getJSON(`/checkins/${encodeURIComponent(id)}`),
    ...options,
  });
}

export function useCheckInTimeline(id, options = {}) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ['checkins', 'timeline', id],
    queryFn: () => getJSON(`/checkins/${encodeURIComponent(id)}/timeline`),
    ...options,
  });
}

export function useCreateCheckIn(options = {}) {
  return useMutation({
    mutationFn: (payload) =>
      sendJSON('/checkins', {
        method: 'POST',
        body: payload,
      }),
    ...options,
  });
}

export function useUpdateCheckIn(options = {}) {
  return useMutation({
    mutationFn: ({ id, ...payload }) =>
      sendJSON(`/checkins/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: payload,
      }),
    ...options,
  });
}

export function useTriggerCheckInPing(options = {}) {
  return useMutation({
    mutationFn: (id) =>
      sendJSON(`/checkins/${encodeURIComponent(id)}/pings/manual`, {
        method: 'POST',
      }),
    ...options,
  });
}

export function useRecordCheckInAttendance(options = {}) {
  return useMutation({
    mutationFn: ({ id, ...payload }) => {
      if (!id) throw new Error('id is required');
      return sendJSON(`/checkins/${encodeURIComponent(id)}/attendance`, {
        method: 'POST',
        body: payload,
      });
    },
    ...options,
  });
}
