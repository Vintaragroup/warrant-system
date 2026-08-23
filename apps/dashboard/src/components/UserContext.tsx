import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
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
  signInWithGoogle: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  users: AuthenticatedUser[];
}

const UserContext = createContext<UserContextType | undefined>(undefined);

async function fetchProfile(): Promise<AuthenticatedUser | null> {
  const response = await fetch(`${API_BASE}/auth/me`, {
    method: 'GET',
    credentials: 'include',
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

  function invalidateAuthSensitiveQueries() {
    try {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch {}
  }

  // On mount (and after a Google OAuth server-side redirect lands back on the
  // app), check whether a session cookie already establishes who we are.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await fetchProfile();
        if (!cancelled) setCurrentUser(profile);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || 'Failed to sign in');
      }
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

  const signInWithGoogle = useCallback(() => {
    window.location.href = `${API_BASE}/auth/google`;
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
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

  const value = useMemo<UserContextType>(() => ({
    currentUser,
    loading,
    error,
    signInWithEmail,
    signInWithGoogle,
    signOut,
    refreshProfile,
    users: currentUser ? [currentUser] : [],
  }), [currentUser, loading, error, signInWithEmail, signInWithGoogle, signOut, refreshProfile]);

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
