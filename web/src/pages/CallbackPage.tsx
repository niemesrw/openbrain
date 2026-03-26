import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { handleOAuthCallback } from "../lib/auth";
import { ErrorAlert } from "../components/ErrorAlert";

export function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

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
      .then(() => {
        if (!cancelled) navigate("/dashboard", { replace: true });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "OAuth callback failed");
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="max-w-md mx-auto">
        <ErrorAlert message={error} />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center text-gray-400">
      Signing you in...
    </div>
  );
}
