/* eslint-disable react-refresh/only-export-components */
// src/components/DashboardAggregatedProvider.jsx
// Optional context provider wiring the serialized polling hook so nested components
// can consume aggregated data without each spinning its own polling timers.
import React, { createContext, useContext, useMemo } from 'react';
import useSerializedPolling from '../hooks/polling.js';

export const DashboardAggContext = createContext(null);

export function DashboardAggregatedProvider({ children, intervals = {} }) {
  /* intervals allows caller to override defaults per key */
  const endpoints = useMemo(() => ([
    { key: 'kpis', path: '/dashboard/kpis', interval: intervals.kpis ?? 60_000 },
    { key: 'top24', path: '/dashboard/top?window=24h&limit=10', interval: intervals.top24 ?? 90_000 },
    { key: 'newToday', path: '/dashboard/new?limit=50', interval: intervals.newToday ?? 30_000 },
    { key: 'recent', path: '/dashboard/recent?limit=50', interval: intervals.recent ?? 45_000 },
    { key: 'perCounty24', path: '/dashboard/per-county?window=24h', interval: intervals.perCounty24 ?? 120_000 },
  ]), [intervals]);

  const polling = useSerializedPolling(endpoints, { enabled: true });

  return (
    <DashboardAggContext.Provider value={polling}>{children}</DashboardAggContext.Provider>
  );
}

export function useDashboardAggregated() {
  const ctx = useContext(DashboardAggContext);
  if (!ctx) throw new Error('useDashboardAggregated must be used within <DashboardAggregatedProvider>');
  return ctx;
}

export function useOptionalDashboardAggregated() {
  try {
    return useContext(DashboardAggContext);
  } catch {
    return null;
  }
}

export default DashboardAggregatedProvider;
