import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Files, BarChart3, Settings, PhoneCall } from 'lucide-react';

const items = [
  { to: '/', label: 'Home', Icon: Home, end: true },
  { to: '/cases', label: 'Cases', Icon: Files },
  { to: '/call-queue', label: 'Queue', Icon: PhoneCall },
  { to: '/reports', label: 'Reports', Icon: BarChart3 },
  { to: '/auth/profile-settings', label: 'Settings', Icon: Settings },
];

export default function BottomNav() {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t shadow-sm"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <ul className="grid grid-cols-4 gap-0">
        {items.map((it) => (
          <li key={it.to} className="min-w-0">
            <NavLink
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                'flex flex-col items-center justify-center py-2 text-xs leading-tight'
                + (isActive ? ' text-blue-600' : ' text-gray-600 hover:text-gray-900')
              }
            >
              <it.Icon className="h-5 w-5" aria-hidden="true" />
              <span className="mt-0.5">{it.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
