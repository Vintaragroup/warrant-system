import { useState } from 'react';
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
import type { AuthScreen } from '../components/auth/types';

const SCREEN_COMPONENTS: Record<AuthScreen, (props: { onNavigate: (screen: AuthScreen) => void }) => JSX.Element> = {
  landing: (props) => <AuthLanding {...props} />,
  login: (props) => <EmailPasswordLogin {...props} />,
  'magic-link': (props) => <MagicLinkRequest {...props} />,
  'social-redirect': (props) => <SocialRedirect {...props} />,
  'mfa-challenge': (props) => <MFAChallenge {...props} />,
  'mfa-enrollment': (props) => <MFAEnrollment {...props} />,
  'forgot-password': (props) => <ForgotPassword {...props} />,
  'account-recovery': (props) => <AccountRecovery {...props} />,
  'auth-success': (props) => <AuthSuccess {...props} />,
  'profile-settings': (props) => <ProfileSettings {...props} />,
  'admin-users': (props) => <AdminUserManagement {...props} />,
  'auth-audit': (props) => <AuthAudit {...props} />,
  'design-guide': (props) => <DesignSystemGuide {...props} />,
  'avatar-showcase': (props) => <AvatarShowcase {...props} />,
};

const SCREEN_OPTIONS: Array<{ value: AuthScreen; label: string }> = [
  { value: 'landing', label: 'Auth Landing' },
  { value: 'login', label: 'Email / Password' },
  { value: 'magic-link', label: 'Magic Link' },
  { value: 'social-redirect', label: 'Social Redirect' },
  { value: 'mfa-challenge', label: 'MFA Challenge' },
  { value: 'mfa-enrollment', label: 'MFA Enrollment' },
  { value: 'forgot-password', label: 'Forgot Password' },
  { value: 'account-recovery', label: 'Account Recovery' },
  { value: 'auth-success', label: 'Auth Success' },
  { value: 'profile-settings', label: 'Profile Settings' },
  { value: 'admin-users', label: 'Admin Users' },
  { value: 'auth-audit', label: 'Auth Audit' },
  { value: 'design-guide', label: 'Design System Guide' },
  { value: 'avatar-showcase', label: 'Avatar Showcase' },
];

export default function AuthPreview() {
  const [current, setCurrent] = useState<AuthScreen>('landing');
  const CurrentScreen = SCREEN_COMPONENTS[current];

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        <select
          value={current}
          onChange={(event) => setCurrent(event.target.value as AuthScreen)}
          className="bg-white border border-accent rounded-lg px-3 py-2 text-sm shadow-sm"
        >
          {SCREEN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <CurrentScreen onNavigate={setCurrent} />
    </div>
  );
}
