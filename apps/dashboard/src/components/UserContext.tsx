import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import {
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  OAuthProvider,
  User as FirebaseUser,
} from 'firebase/auth';
import { firebaseAuthClient } from '../lib/firebaseClient';
import type { UserProfile } from './ui/user-avatar';
import { API_BASE } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';

type AuthenticatedUser = UserProfile & {
  uid: string;
  roles: string[];
  departments: string[];
  counties: string[];
  status: string;
  mfaEnforced?: boolean;
};

interface UserContextType {
  currentUser: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithProvider: (provider: 'google' | 'apple') => Promise<void>;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  users: AuthenticatedUser[];
}

const UserContext = createContext<UserContextType | undefined>(undefined);

async function exchangeSession(idToken: string) {
  const response = await fetch(`${API_BASE}/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to establish session');
  }
}

async function fetchProfile(): Promise<AuthenticatedUser | null> {
  let headers: Record<string, string> | undefined;
  try {
    const token = await firebaseAuthClient.currentUser?.getIdToken();
    if (token) headers = { Authorization: `Bearer ${token}` };
  } catch {}
  const response = await fetch(`${API_BASE}/auth/me`, {
    method: 'GET',
    credentials: 'include',
    headers,
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Profile request failed');
  }

  const payload = await response.json();
  return mapProfile(payload?.user);
}

function mapProfile(user: any): AuthenticatedUser | null {
  if (!user) return null;
  const name = user.displayName || user.name || user.email || user.uid;
  const email = user.email || '';
  const primaryRole = Array.isArray(user.roles) && user.roles.length ? user.roles[0] : 'BondClient';
  const initials = typeof name === 'string'
    ? name
        .split(' ')
        .map((part: string) => part.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'BB';

  let avatarIcon = user.avatarIcon || null;
  let avatarColor = user.avatarColor || null;
  const roles = Array.isArray(user.roles) ? user.roles : [primaryRole];

  if (!avatarIcon) {
    if (roles.includes('SuperUser')) avatarIcon = 'crown';
    else if (roles.includes('Admin')) avatarIcon = 'shield';
    else if (roles.includes('DepartmentLead')) avatarIcon = 'briefcase';
    else if (roles.includes('Employee')) avatarIcon = 'userCheck';
    else avatarIcon = 'user';
  }

  if (!avatarColor) {
    if (roles.includes('SuperUser')) avatarColor = 'purple';
    else if (roles.includes('Admin')) avatarColor = 'indigo';
    else if (roles.includes('DepartmentLead')) avatarColor = 'emerald';
    else avatarColor = 'blue';
  }

  return {
    uid: user.uid,
    id: user.uid,
    name,
    email,
    role: primaryRole,
    initials,
    avatarIcon,
    avatarColor,
    roles,
    departments: Array.isArray(user.departments) ? user.departments : [],
    counties: Array.isArray(user.counties) ? user.counties : [],
    status: user.status || 'active',
    mfaEnforced: Boolean(user.mfaEnforced),
    displayName: user.displayName || name,
    profileImage: user.profileImage || undefined,
  };
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const REDIRECT_FLAG = 'asap_auth_redirect_pending';

  function invalidateAuthSensitiveQueries() {
    try {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch {}
  }

  const handleFirebaseUser = useCallback(async (fbUser: FirebaseUser | null) => {
    if (!fbUser) {
      setCurrentUser(null);
      setLoading(false);
      return;
    }

    try {
      const idToken = await fbUser.getIdToken(true);
      await exchangeSession(idToken);
      const profile = await fetchProfile();
      setCurrentUser(profile);
  invalidateAuthSensitiveQueries();
      setError(null);
    } catch (err) {
      console.error('Failed to sync Firebase session:', err);
      setError(err instanceof Error ? err.message : String(err));
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If we initiated a redirect sign-in, reflect that in loading UI immediately
    try {
      if (window.sessionStorage.getItem(REDIRECT_FLAG) === '1') {
        setLoading(true);
      }
    } catch {}

    // Complete OAuth redirect sign-in if we have a result (important for iOS).
    // During this phase, keep loading=true so the UI shows a spinner instead of a blank state.
    setLoading(true);
    getRedirectResult(firebaseAuthClient)
      .then(async (result) => {
        if (!result || !result.user) return;
        const idToken = await result.user.getIdToken(true);
        await exchangeSession(idToken);
        const profile = await fetchProfile();
        setCurrentUser(profile);
        invalidateAuthSensitiveQueries();
      })
      .catch((err) => {
        if (err) {
          console.warn('OAuth redirect sign-in failed:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        try { window.sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
        // Don't force loading=false here; let onAuthStateChanged finalize based on actual auth state
      });

    const unsubscribe = onAuthStateChanged(firebaseAuthClient, (fbUser) => {
      setLoading(true);
      handleFirebaseUser(fbUser);
    });
    return () => unsubscribe();
  }, [handleFirebaseUser]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuthClient, email, password);
      const idToken = await credential.user.getIdToken(true);
      await exchangeSession(idToken);
      const profile = await fetchProfile();
      setCurrentUser(profile);
  invalidateAuthSensitiveQueries();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign in';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signInWithProvider = useCallback(async (provider: 'google' | 'apple') => {
    setLoading(true);
    setError(null);
    try {
      const providerInstance = provider === 'google'
        ? new GoogleAuthProvider()
        : new OAuthProvider('apple.com');

      if (provider === 'apple') {
        providerInstance.addScope?.('email');
        providerInstance.addScope?.('name');
      }

      const isMobileWeb = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobileWeb) {
        // iOS Safari/Chrome often blocks popups; prefer redirect on mobile
        try { window.sessionStorage.setItem(REDIRECT_FLAG, '1'); } catch {}
        await signInWithRedirect(firebaseAuthClient, providerInstance);
        return; // flow will continue after redirect
      }

      try {
        const credential = await signInWithPopup(firebaseAuthClient, providerInstance);
        const idToken = await credential.user.getIdToken(true);
        await exchangeSession(idToken);
        const profile = await fetchProfile();
        setCurrentUser(profile);
        invalidateAuthSensitiveQueries();
      } catch (popupErr) {
        const code = (popupErr && popupErr.code) || '';
        const shouldFallback = typeof code === 'string' && (code.includes('operation-not-supported') || code.includes('popup-blocked') || code.includes('popup-closed'));
        if (shouldFallback) {
          try { window.sessionStorage.setItem(REDIRECT_FLAG, '1'); } catch {}
          await signInWithRedirect(firebaseAuthClient, providerInstance);
          return;
        }
        throw popupErr;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign in with provider';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
      await firebaseSignOut(firebaseAuthClient);
      setCurrentUser(null);
      setError(null);
  invalidateAuthSensitiveQueries();
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await fetchProfile();
      setCurrentUser(profile);
      invalidateAuthSensitiveQueries();
    } catch (err) {
      console.error('Failed to refresh profile:', err);
    }
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      const actionCodeSettings = {
        url: `${window.location.origin}/auth/login`,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(firebaseAuthClient, email, actionCodeSettings);
      window.localStorage.setItem('asapAuthEmail', email);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send magic link';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSignInWithEmailLink(firebaseAuthClient, window.location.href)) {
      const storedEmail = window.localStorage.getItem('asapAuthEmail') || window.prompt('Confirm your email');
      if (storedEmail) {
        signInWithEmailLink(firebaseAuthClient, storedEmail, window.location.href)
          .then(async (credential) => {
            const idToken = await credential.user.getIdToken(true);
            await exchangeSession(idToken);
            const profile = await fetchProfile();
            setCurrentUser(profile);
            invalidateAuthSensitiveQueries();
            window.localStorage.removeItem('asapAuthEmail');
          })
          .catch((err) => {
            console.error('Magic link sign-in failed:', err);
            setError(err instanceof Error ? err.message : String(err));
          });
      }
    }
  }, []);

  const value = useMemo<UserContextType>(() => ({
    currentUser,
    loading,
    error,
    signInWithEmail,
    signInWithProvider,
    sendMagicLink,
    signOut,
    refreshProfile,
    users: currentUser ? [currentUser] : [],
  }), [currentUser, loading, error, signInWithEmail, signInWithProvider, sendMagicLink, signOut, refreshProfile]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

export type { AuthenticatedUser };
