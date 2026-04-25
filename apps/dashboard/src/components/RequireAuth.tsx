import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useUser } from './UserContext';

interface RequireAuthProps {
  children: React.ReactNode;
}

export default function RequireAuth({ children }: RequireAuthProps) {
  const { currentUser, loading } = useUser();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-600">Checking authentication&hellip;</div>
      </div>
    );
  }

  if (!currentUser) {
    const from = `${location.pathname}${location.search || ''}${location.hash || ''}`;
    return (
      <Navigate
        to="/auth/login"
        replace
        state={{ from }}
      />
    );
  }

  return <>{children}</>;
}
