import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { handleOAuthCallback } from "../lib/auth";

export function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
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
      .catch((err) => setError(err.message || "OAuth callback failed"));
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="max-w-md mx-auto">
        <div className="bg-red-900/50 text-red-300 px-4 py-2 rounded">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center text-gray-400">
      Signing you in...
    </div>
  );
}
