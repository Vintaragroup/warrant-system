import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard';

export interface UserAccount {
  uid: string;
  email: string;
  displayName?: string;
  roles: string[];
  departments: string[];
  counties: string[];
  status: 'active' | 'suspended' | 'invited' | 'pending_mfa' | 'deleted';
  mfaEnforced?: boolean;
  lastLoginAt?: string | null;
  invitedAt?: string | null;
  invitedBy?: string | null;
  lastRoleChangeAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateUserPayload {
  email: string;
  displayName?: string;
  roles?: string[];
  departments?: string[];
  counties?: string[];
  status?: UserAccount['status'];
}

export interface UpdateUserPayload {
  email?: string;
  displayName?: string;
  roles?: string[];
  departments?: string[];
  counties?: string[];
  status?: UserAccount['status'];
  mfaEnforced?: boolean;
}

export function useUsers(filters: { role?: string; status?: string; search?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString();

  return useQuery({
    queryKey: ['users', qs],
    queryFn: async () => {
      const data = await getJSON(`/users${qs ? `?${qs}` : ''}`);
      return Array.isArray(data?.users) ? (data.users as UserAccount[]) : [];
    },
    staleTime: 60_000,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateUserPayload) => {
      const data = await sendJSON('/users', {
        method: 'POST',
        body: payload,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uid, payload }: { uid: string; payload: UpdateUserPayload }) => {
      if (!uid) throw new Error('uid is required');
      const data = await sendJSON(`/users/${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        body: payload,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useRevokeUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (uid: string) => {
      if (!uid) throw new Error('uid is required');
      const data = await sendJSON(`/users/${encodeURIComponent(uid)}/revoke`, {
        method: 'POST',
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
