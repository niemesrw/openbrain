import { Link, Outlet, useNavigate } from "react-router-dom";
import { getCurrentUser, signOut } from "../lib/auth";

export function Layout() {
  const navigate = useNavigate();
  const user = getCurrentUser();

  const handleSignOut = () => {
    signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold text-white">
          Open Brain
        </Link>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Link to="/dashboard" className="text-gray-300 hover:text-white">
                Brain
              </Link>
              <Link to="/feed" className="text-gray-300 hover:text-white">
                Feed
              </Link>
              <Link to="/guide" className="text-gray-300 hover:text-white">
                Guide
              </Link>
              <Link to="/settings" className="text-gray-300 hover:text-white">
                Settings
              </Link>
              <button
                onClick={handleSignOut}
                className="text-gray-400 hover:text-white"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/guide" className="text-gray-300 hover:text-white">
                Guide
              </Link>
              <Link to="/login" className="text-gray-300 hover:text-white">
                Log in
              </Link>
              <Link
                to="/signup"
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500"
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
      <footer className="border-t border-gray-800 mt-16 px-6 py-6 text-center text-sm text-gray-500 flex justify-center gap-6">
        <Link to="/privacy" className="hover:text-gray-300">Privacy</Link>
        <Link to="/terms" className="hover:text-gray-300">Terms</Link>
        <a href="mailto:hello@blanxlait.ai" className="hover:text-gray-300">Contact</a>
      </footer>
    </div>
  );
}
