import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getJSON, sendJSON } from './dashboard';

export interface Payment {
  id: string;
  transactionId: string;
  amount: number;
  fees?: number | null;
  netAmount?: number | null;
  currency: string;
  method: string;
  status: string;
  bondNumber?: string;
  clientName?: string;
  clientEmail?: string;
  processedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  flags?: string[];
  failureReason?: string | null;
}

export interface PaymentListResponse {
  items: Payment[];
  total: number;
}

export interface PaymentMetricsResponse {
  summary: {
    totalRevenue: { value: number; currency: string; changeRatio: number; label: string };
    activeBonds: { value: number; change: number; label: string };
    successRate: { value: number; change: number; label: string };
    pendingPayments: { value: number; change: number; label: string };
  };
  methodBreakdown: Array<{ method: string; percentage: number }>;
  revenueTrend: Array<{ month: string; amount: number }>;
  alerts: Array<{ id: string; severity: string; title: string; description: string }>;
  upcomingPayouts: Array<{ id: string; arrivalDate: string; amount: number; status: string; method: string }>;
}

export interface PaymentMethod {
  id: string;
  type: string;
  brand?: string | null;
  last4?: string | null;
  expiryMonth?: number | null;
  expiryYear?: number | null;
  bankName?: string | null;
  accountType?: string | null;
  label?: string | null;
  isDefault: boolean;
  status: string;
}

export interface PaymentSettings {
  defaultMethodId?: string | null;
  acceptedMethods?: string[];
  autoCapture?: boolean;
  autoCaptureDelayMinutes?: number | null;
  receiptEmailEnabled?: boolean;
  approvalThreshold?: number | null;
  twoPersonApproval?: boolean;
  notifyOnLargePayment?: boolean;
  notifyRecipients?: string[];
  automationRules?: Array<{ id: string; title: string; enabled: boolean }>;
}

export interface RefundEligibleItem {
  id: string;
  caseNumber: string;
  client: string;
  originalAmount: number;
  refundableAmount: number;
  status: string;
  daysAgo: number;
}

export interface RefundRequestItem {
  id: string;
  transactionId: string;
  client: string;
  requestedAt: string;
  amount: number;
  status: string;
  reason?: string;
  requestedBy?: string;
}

export interface DisputeItem {
  id: string;
  transactionId: string;
  amount: number;
  openedAt: string;
  client: string;
  reason: string;
  status: string;
  responseDeadline?: string;
  resolvedAt?: string | null;
  notes?: string | null;
}

function buildQueryString(params: Record<string, string | number | undefined | null>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      searchParams.set(key, String(value));
    }
  });
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

export function usePaymentMetrics() {
  return useQuery<PaymentMetricsResponse>({
    queryKey: ['payments', 'metrics'],
    queryFn: async () => getJSON('/payments/metrics'),
    staleTime: 60_000,
  });
}

export function usePayments(filters: { status?: string; method?: string; search?: string } = {}) {
  const queryString = useMemo(
    () => buildQueryString({ status: filters.status, method: filters.method, search: filters.search }),
    [filters.status, filters.method, filters.search]
  );

  return useQuery<PaymentListResponse>({
    queryKey: ['payments', 'list', queryString],
    queryFn: async () => getJSON(`/payments${queryString}`),
    staleTime: 30_000,
  });
}

export function usePaymentDetail(id?: string) {
  return useQuery<{ payment: Payment }>({
    enabled: Boolean(id),
    queryKey: ['payments', 'detail', id],
    queryFn: async () => getJSON(`/payments/${id}`),
    staleTime: 30_000,
  });
}

export function usePaymentMethods() {
  return useQuery<{ methods: PaymentMethod[] }>({
    queryKey: ['payments', 'methods'],
    queryFn: async () => getJSON('/payments/methods'),
    staleTime: 60_000,
  });
}

export function useCreatePaymentMethod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<PaymentMethod>) => sendJSON('/payments/methods', { method: 'POST', body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', 'methods'] });
    },
  });
}

export function usePaymentSettings() {
  return useQuery<{ settings: PaymentSettings }>({
    queryKey: ['payments', 'settings'],
    queryFn: async () => getJSON('/payments/settings'),
    staleTime: 60_000,
  });
}

export function useUpdatePaymentSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PaymentSettings) => sendJSON('/payments/settings', { method: 'PUT', body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', 'settings'] });
    },
  });
}

export function useRefundEligible() {
  return useQuery<{ items: RefundEligibleItem[] }>({
    queryKey: ['payments', 'refunds', 'eligible'],
    queryFn: async () => getJSON('/payments/refunds/eligible'),
    staleTime: 30_000,
  });
}

export function useRefundRequests() {
  return useQuery<{ items: RefundRequestItem[] }>({
    queryKey: ['payments', 'refunds', 'requests'],
    queryFn: async () => getJSON('/payments/refunds/requests'),
    staleTime: 30_000,
  });
}

export function useSubmitRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: { amount: number; reason?: string } }) =>
      sendJSON(`/payments/${encodeURIComponent(id)}/refund`, { method: 'POST', body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', 'refunds'] });
      queryClient.invalidateQueries({ queryKey: ['payments', 'list'] });
    },
  });
}

export function usePaymentDisputes() {
  return useQuery<{ items: DisputeItem[] }>({
    queryKey: ['payments', 'disputes'],
    queryFn: async () => getJSON('/payments/disputes'),
    staleTime: 30_000,
  });
}

export function useResolveDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload?: { notes?: string; documents?: Array<{ name: string; url: string }> } }) =>
      sendJSON(`/payments/disputes/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', 'disputes'] });
    },
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      amount: number;
      currency?: string;
      method?: string;
      clientName?: string;
      clientEmail?: string;
      paymentType?: string;
      description?: string;
      bondNumber?: string;
      metadata?: Record<string, unknown>;
    }) => sendJSON<{ payment: Payment; clientSecret?: string }>('/payments', { method: 'POST', body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['payments', 'metrics'] });
    },
  });
}
