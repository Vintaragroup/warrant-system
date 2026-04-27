import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ToastProvider } from "../components/ToastContext";
import { useUser } from "../components/UserContext";
import { PillButton } from "../components/ui/pill-button";
import { UserAvatar } from "../components/ui/user-avatar";
import BottomNav from "../components/BottomNav";

const tabs = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/prospects", label: "Prospects" },
  { to: "/crm", label: "CRM" },
  { to: "/call-queue", label: "Call Queue" },
  { to: "/reports", label: "Reports" },
  { to: "/admin", label: "Admin", requiresAdmin: true },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const { currentUser, signOut } = useUser();

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate('/auth/login', { replace: true });
    }
  };

  return (
    <ToastProvider>
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-white border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-tight">Bail Bonds Dashboard</span>
          <nav className="hidden md:flex gap-4">
            {tabs.map(t => {
              // Hide Admin tab if user doesn't have Admin/Super Admin role
              if (t.requiresAdmin) {
                const roles = currentUser?.roles || [];
                const hasAdmin = roles.includes('Admin') || roles.includes('SuperUser') || roles.includes('Super Admin') || roles.includes('super_admin');
                if (!hasAdmin) return null;
              }
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    "text-sm px-2 py-1 rounded-md " +
                    (isActive ? "bg-gray-100 font-semibold" : "text-gray-600 hover:text-gray-900")
                  }
                >
                  {t.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            {currentUser && (
              <UserAvatar
                user={currentUser}
                size="sm"
                className="cursor-pointer"
                onClick={() => navigate('/auth/profile-settings')}
              />
            )}
            <PillButton size="sm" variant="outline" onClick={handleSignOut}>
              Sign out
            </PillButton>
          </div>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="md:hidden border-b bg-white">
        <div className="mx-auto max-w-7xl px-2 py-2 flex gap-2 overflow-x-auto">
          {tabs.map(t => {
            // Hide Admin tab if user doesn't have Admin/Super Admin role
            if (t.requiresAdmin) {
              const roles = currentUser?.roles || [];
              const hasAdmin = roles.includes('Admin') || roles.includes('SuperUser') || roles.includes('Super Admin') || roles.includes('super_admin');
              if (!hasAdmin) return null;
            }
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  "text-xs whitespace-nowrap px-2 py-1 rounded-md " +
                  (isActive ? "bg-gray-100 font-semibold" : "text-gray-600 hover:text-gray-900")
                }
              >
                {t.label}
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* Page content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6">
        <Outlet />
      </main>
      {/* bottom nav for mobile */}
      <BottomNav />
    </div>
    </ToastProvider>
  );
}
