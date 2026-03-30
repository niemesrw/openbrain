import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { getCurrentUser, signOut } from "../lib/auth";

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getCurrentUser();

  const handleSignOut = () => {
    signOut();
    navigate("/login");
  };

  const navLink = (to: string, label: string) => {
    const active = location.pathname === to || location.pathname.startsWith(to + "/");
    return (
      <Link
        to={to}
        className={`text-sm transition-colors font-label ${
          active ? "text-brain-primary" : "text-brain-muted hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-brain-base">
      <nav className="glass-panel sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="font-headline text-xl font-semibold text-white tracking-tight">
          Brain <span className="text-brain-muted/60 text-sm font-normal">by BLANXLAIT</span>
        </Link>
        <div className="flex items-center gap-6">
          {user ? (
            <>
              {navLink("/dashboard", "Brain")}
              {navLink("/feed", "Feed")}
              {navLink("/guide", "Guide")}
              {navLink("/settings", "Settings")}
              <button
                onClick={handleSignOut}
                className="text-sm text-brain-muted/60 hover:text-brain-muted transition-colors font-label"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              {navLink("/guide", "Guide")}
              {navLink("/login", "Log in")}
              <Link
                to="/signup"
                className="bg-brain-primary text-brain-primary-on text-sm font-label font-medium px-4 py-2 rounded-lg hover:bg-brain-primary-dim transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
      <main className="max-w-4xl mx-auto px-6 py-8">
        <Outlet />
      </main>
      <footer className="mt-16 px-6 py-6 text-center text-sm text-brain-muted/40 flex justify-center gap-6 font-label">
        <Link to="/privacy" className="hover:text-brain-muted transition-colors">Privacy</Link>
        <Link to="/terms" className="hover:text-brain-muted transition-colors">Terms</Link>
        <a href="mailto:hello@blanxlait.ai" className="hover:text-brain-muted transition-colors">Contact</a>
      </footer>
    </div>
  );
}
