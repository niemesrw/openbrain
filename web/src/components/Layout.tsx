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
                Dashboard
              </Link>
              <Link to="/feed" className="text-gray-300 hover:text-white">
                Feed
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
    </div>
  );
}
