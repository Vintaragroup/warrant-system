import React from 'react';
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AuthLanding } from '../components/auth/AuthLanding';
import { EmailPasswordLogin } from '../components/auth/EmailPasswordLogin';
import { MagicLinkRequest } from '../components/auth/MagicLinkRequest';
import { SocialRedirect } from '../components/auth/SocialRedirect';
import { MFAChallenge } from '../components/auth/MFAChallenge';
import { MFAEnrollment } from '../components/auth/MFAEnrollment';
import { ForgotPassword } from '../components/auth/ForgotPassword';
import { AccountRecovery } from '../components/auth/AccountRecovery';
import { AuthSuccess } from '../components/auth/AuthSuccess';
import { ProfileSettings } from '../components/auth/ProfileSettings';
import { AdminUserManagement } from '../components/auth/AdminUserManagement';
import { AuthAudit } from '../components/auth/AuthAudit';
import { DesignSystemGuide } from '../components/DesignSystemGuide';
import { AvatarShowcase } from '../components/AvatarShowcase';
import { BillingDashboard } from '../components/payments/BillingDashboard';
import { PaymentMethods } from '../components/payments/PaymentMethods';
import { PaymentForm } from '../components/payments/PaymentForm';
import { PaymentConfirmation } from '../components/payments/PaymentConfirmation';
import { PaymentHistory } from '../components/payments/PaymentHistory';
import { PaymentSettings } from '../components/payments/PaymentSettings';
import { RefundProcessing } from '../components/payments/RefundProcessing';
import { PaymentDisputes } from '../components/payments/PaymentDisputes';
import type { AuthScreen } from '../components/auth/types';
import { useUser } from '../components/UserContext';

const SCREEN_COMPONENTS: Record<AuthScreen, React.ComponentType<{ onNavigate: (screen: AuthScreen) => void }>> = {
  landing: AuthLanding,
  login: EmailPasswordLogin,
  'magic-link': MagicLinkRequest,
  'social-redirect': SocialRedirect,
  'mfa-challenge': MFAChallenge,
  'mfa-enrollment': MFAEnrollment,
  'forgot-password': ForgotPassword,
  'account-recovery': AccountRecovery,
  'auth-success': AuthSuccess,
  'profile-settings': ProfileSettings,
  'admin-users': AdminUserManagement,
  'auth-audit': AuthAudit,
  'design-guide': DesignSystemGuide,
  'avatar-showcase': AvatarShowcase,
  'billing-dashboard': BillingDashboard,
  'payment-methods': PaymentMethods,
  'payment-form': PaymentForm,
  'payment-confirmation': PaymentConfirmation,
  'payment-history': PaymentHistory,
  'payment-settings': PaymentSettings,
  'refund-processing': RefundProcessing,
  'payment-disputes': PaymentDisputes,
};

export function AuthRoutes() {
  const navigate = useNavigate();
  const params = useParams<{ screen?: AuthScreen }>();
  const location = useLocation();
  const { currentUser, loading } = useUser();

  const screenKey = params.screen ?? 'landing';
  const Component = SCREEN_COMPONENTS[screenKey] ?? AuthLanding;

  const state = (location.state as { from?: string } | null) || undefined;
  const redirectTarget = state?.from || '/';

  const handleNavigate = (next: AuthScreen) => {
    const nextPath = next === 'landing' ? '/auth' : `/auth/${next}`;
    navigate(nextPath, { state });
  };

  useEffect(() => {
    const autoRedirectScreens: AuthScreen[] = ['landing', 'login', 'magic-link', 'auth-success'];
    if (!loading && currentUser && autoRedirectScreens.includes(screenKey)) {
      navigate(redirectTarget, { replace: true });
    }
  }, [currentUser, loading, screenKey, redirectTarget, navigate]);

  return <Component onNavigate={handleNavigate} />;
}

export default AuthRoutes;
