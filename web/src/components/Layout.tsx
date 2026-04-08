import { Link, Outlet, useLocation } from "react-router-dom";
import { getCurrentUser } from "../lib/auth";

const NAV_TABS = [
  { to: "/dashboard", label: "Brain", icon: "psychology" },
  { to: "/feed", label: "Feed", icon: "dynamic_feed" },
  { to: "/agents", label: "Agents", icon: "smart_toy" },
  { to: "/tasks", label: "Tasks", icon: "schedule" },
  { to: "/settings", label: "Settings", icon: "manage_accounts" },
];

export function Layout() {
  const location = useLocation();
  const user = getCurrentUser();

  const isAuth = !!user;
  const initial = user?.getUsername()?.[0]?.toUpperCase() ?? "U";

  const isActive = (to: string) =>
    location.pathname === to || location.pathname.startsWith(to + "/");

  return (
    <div className="min-h-screen bg-brain-base">
      {/* Top header */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between bg-[#0e0e0e]/60 backdrop-blur-xl shadow-[0_0_32px_rgba(154,168,255,0.08)]">
        <Link to="/" className="font-headline text-lg font-semibold text-white tracking-tight flex items-center gap-2">
          <span className="material-symbols-outlined text-brain-primary text-2xl">psychology</span>
          OpenBrain
        </Link>

        {isAuth ? (
          <>
            {/* Desktop nav links */}
            <nav className="hidden md:flex items-center gap-6">
              {NAV_TABS.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={`text-sm font-label transition-colors ${
                    isActive(to) ? "text-brain-primary" : "text-brain-muted hover:text-white"
                  }`}
                >
                  {label}
                </Link>
              ))}
              <Link
                to="/guide"
                className={`text-sm font-label transition-colors ${isActive("/guide") ? "text-brain-primary" : "text-brain-muted hover:text-white"}`}
              >
                Guide
              </Link>
              <Link
                to="/settings"
                title="Profile"
                aria-label="Profile"
                className="w-8 h-8 rounded-full bg-brain-surface flex items-center justify-center text-xs text-brain-muted font-label font-semibold hover:bg-brain-high transition-colors"
              >
                {initial}
              </Link>
            </nav>

            {/* Mobile: avatar only */}
            <Link
              to="/settings"
              title="Profile"
              aria-label="Profile"
              className="md:hidden w-8 h-8 rounded-full bg-brain-surface flex items-center justify-center text-xs text-brain-muted font-label font-semibold hover:bg-brain-high transition-colors"
            >
              {initial}
            </Link>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <Link
              to="/guide"
              className={`text-sm font-label transition-colors ${isActive("/guide") ? "text-brain-primary" : "text-brain-muted hover:text-white"}`}
            >
              Guide
            </Link>
            <Link
              to="/login"
              className={`text-sm font-label transition-colors ${isActive("/login") ? "text-brain-primary" : "text-brain-muted hover:text-white"}`}
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="bg-brain-primary text-brain-primary-on text-sm font-label font-medium px-4 py-1.5 rounded-lg hover:bg-brain-primary-dim transition-colors"
            >
              Sign up
            </Link>
          </div>
        )}
      </header>

      {/* Main content — narrow on mobile, wide on desktop */}
      <main className={`mx-auto px-4 pt-20 md:px-8 max-w-lg md:max-w-4xl ${isAuth ? "pb-24 md:pb-10" : "pb-12"}`}>
        <Outlet />
      </main>

      {/* Bottom nav — mobile only */}
      {isAuth && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0e0e0e]/80 backdrop-blur-2xl rounded-t-[24px] border-t border-brain-outline/15 shadow-[0_-8px_32px_rgba(0,0,0,0.5)]">
          <div className="max-w-lg mx-auto flex items-center justify-around px-2 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {NAV_TABS.map(({ to, label, icon }) => {
              const active = isActive(to);
              return (
                <Link
                  key={to}
                  to={to}
                  className={`flex flex-col items-center gap-1 px-4 transition-all ${
                    active
                      ? "text-brain-secondary drop-shadow-[0_0_12px_rgba(0,227,253,0.3)]"
                      : "text-brain-muted hover:text-white"
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-2xl"
                    style={{ fontVariationSettings: active ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
                  >
                    {icon}
                  </span>
                  <span className="text-[10px] font-label font-medium tracking-widest uppercase">{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Footer — non-authenticated pages only */}
      {!isAuth && (
        <footer className="px-6 py-6 text-center text-sm text-brain-muted/40 flex justify-center gap-6 font-label">
          <Link to="/privacy" className="hover:text-brain-muted transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-brain-muted transition-colors">Terms</Link>
          <a href="mailto:hello@example.com" className="hover:text-brain-muted transition-colors">Contact</a>
        </footer>
      )}
    </div>
  );
}
