import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { connectGitHubInstallation } from "../lib/api";

export function GitHubCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"connecting" | "success" | "error">("connecting");
  const [accountLogin, setAccountLogin] = useState("");
  const [error, setError] = useState("");
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action");

    if (!installationId) {
      setError("No installation_id in URL. Did you arrive here from GitHub?");
      setStatus("error");
      return;
    }

    // GitHub sends setup_action=install (new) or setup_action=update (permissions change)
    if (setupAction !== "install" && setupAction !== "update") {
      setError(`Unexpected setup_action: ${setupAction}`);
      setStatus("error");
      return;
    }

    connectGitHubInstallation(installationId)
      .then((result) => {
        setAccountLogin(result.accountLogin);
        setStatus("success");
        // Auto-redirect to settings after 2s
        setTimeout(() => navigate("/settings"), 2000);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Connection failed");
        setStatus("error");
      });
  }, [searchParams, navigate]);

  if (status === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400">Connecting your GitHub account…</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="text-4xl">✓</div>
        <h2 className="text-xl font-semibold text-white">Connected!</h2>
        <p className="text-gray-400">
          <span className="text-white font-medium">{accountLogin}</span> is now linked to your brain.
          GitHub activity will be captured automatically.
        </p>
        <p className="text-gray-500 text-sm">Redirecting to settings…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="text-4xl">✗</div>
      <h2 className="text-xl font-semibold text-white">Connection failed</h2>
      <p className="text-red-400">{error}</p>
      <Link to="/settings" className="text-blue-400 hover:text-blue-300 text-sm">
        Back to settings
      </Link>
    </div>
  );
}
