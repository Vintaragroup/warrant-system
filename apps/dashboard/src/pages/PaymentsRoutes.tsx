import React, { useCallback } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import type { AuthScreen } from '../components/auth/types';
import { BillingDashboard } from '../components/payments/BillingDashboard';
import { PaymentMethods } from '../components/payments/PaymentMethods';
import { PaymentForm } from '../components/payments/PaymentForm';
import { PaymentConfirmation } from '../components/payments/PaymentConfirmation';
import { PaymentHistory } from '../components/payments/PaymentHistory';
import { PaymentSettings } from '../components/payments/PaymentSettings';
import { RefundProcessing } from '../components/payments/RefundProcessing';
import { PaymentDisputes } from '../components/payments/PaymentDisputes';
import { hasStripeKey, stripePromise } from '../lib/stripeClient';

const SCREEN_TO_PATH: Partial<Record<AuthScreen, string>> = {
  landing: '/',
  'billing-dashboard': '/payments',
  'payment-methods': '/payments/methods',
  'payment-form': '/payments/new',
  'payment-confirmation': '/payments/confirmation',
  'payment-history': '/payments/history',
  'payment-settings': '/payments/settings',
  'refund-processing': '/payments/refunds',
  'payment-disputes': '/payments/disputes',
};

type NavigateOptions = Parameters<ReturnType<typeof useNavigate>>[1];

function usePaymentNavigation() {
  const navigate = useNavigate();
  return useCallback(
    (screen: AuthScreen, options?: NavigateOptions) => {
      const target = SCREEN_TO_PATH[screen] || '/payments';
      navigate(target, options);
    },
    [navigate]
  );
}

function renderWithStripe(element: React.ReactNode) {
  if (!hasStripeKey || !stripePromise) return element;
  return (
    <Elements stripe={stripePromise}>
      {element}
    </Elements>
  );
}

export default function PaymentsRoutes() {
  const handleNavigate = usePaymentNavigation();

  return (
    <Routes>
      <Route index element={renderWithStripe(<BillingDashboard onNavigate={handleNavigate} />)} />
      <Route path="methods" element={renderWithStripe(<PaymentMethods onNavigate={handleNavigate} />)} />
      <Route path="new" element={renderWithStripe(<PaymentForm onNavigate={handleNavigate} />)} />
      <Route path="confirmation" element={renderWithStripe(<PaymentConfirmation onNavigate={handleNavigate} />)} />
      <Route path="history" element={renderWithStripe(<PaymentHistory onNavigate={handleNavigate} />)} />
      <Route path="settings" element={renderWithStripe(<PaymentSettings onNavigate={handleNavigate} />)} />
      <Route path="refunds" element={renderWithStripe(<RefundProcessing onNavigate={handleNavigate} />)} />
      <Route path="disputes" element={renderWithStripe(<PaymentDisputes onNavigate={handleNavigate} />)} />
      <Route path="*" element={<Navigate to="/payments" replace />} />
    </Routes>
  );
}
