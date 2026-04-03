import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { handleOAuthCallback } from "../lib/auth";
import { ErrorAlert } from "../components/ErrorAlert";

export function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const handledRef = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in dev — guard against double-consuming the auth code
    if (handledRef.current) return;
    handledRef.current = true;

    const oauthError = searchParams.get("error");
    if (oauthError) {
      const desc = searchParams.get("error_description") || oauthError;
      setError(`Sign-in failed: ${desc}`);
      return;
    }

    const code = searchParams.get("code");
    if (!code) {
      setError("No authorization code in callback URL");
      return;
    }

    const state = searchParams.get("state");
    handleOAuthCallback(code, state)
      .then(() => navigate("/dashboard", { replace: true }))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="max-w-md mx-auto">
        <ErrorAlert message={error} />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center text-brain-muted font-label">
      Signing you in...
    </div>
  );
}
