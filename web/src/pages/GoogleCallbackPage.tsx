import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { connectGoogleCallback } from "../lib/api";

export function GoogleCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"connecting" | "success" | "error">("connecting");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setError(`Google denied the connection: ${errorParam}`);
      setStatus("error");
      return;
    }

    if (!code || !state) {
      setError("Invalid callback URL. Did you arrive here from Google?");
      setStatus("error");
      return;
    }

    connectGoogleCallback(code, state)
      .then((result) => {
        setEmail(result.email);
        setStatus("success");
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
        <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400">Connecting your Gmail account…</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="text-4xl">✓</div>
        <h2 className="text-xl font-semibold text-white">Connected!</h2>
        <p className="text-gray-400">
          <span className="text-white font-medium">{email}</span> is now linked to your brain.
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
