import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { handleOAuthCallback } from "../lib/auth";
import { ErrorAlert } from "../components/ErrorAlert";

type Phase = "loading" | "success" | "error";

export function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");
  const handledRef = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in dev — guard against double-consuming the auth code
    if (handledRef.current) return;
    handledRef.current = true;

    let mounted = true;

    const oauthError = searchParams.get("error");
    if (oauthError) {
      const desc = searchParams.get("error_description") || oauthError;
      setError(`Sign-in failed: ${desc}`);
      setPhase("error");
      return;
    }

    const code = searchParams.get("code");
    if (!code) {
      setError("No authorization code in callback URL");
      setPhase("error");
      return;
    }

    let redirectTimer: ReturnType<typeof setTimeout>;
    const state = searchParams.get("state");
    handleOAuthCallback(code, state)
      .then(() => {
        if (!mounted) return;
        setPhase("success");
        redirectTimer = setTimeout(() => navigate("/dashboard", { replace: true }), 1400);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });

    return () => {
      mounted = false;
      clearTimeout(redirectTimer);
    };
  }, [searchParams, navigate]);

  if (phase === "error") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="max-w-md w-full">
          <ErrorAlert message={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-brain-base overflow-hidden">
      {/* Atmospheric glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-brain-primary/8 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-brain-secondary/6 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-brain-tertiary/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative flex flex-col items-center gap-6 text-center px-6">
        {/* Brain icon with orbital ring */}
        <div className="relative flex items-center justify-center">
          {/* Outer pulse ring */}
          <div
            className={`absolute w-28 h-28 rounded-full border border-brain-primary/20 transition-all duration-700 motion-reduce:transition-none ${
              phase === "success" ? "scale-150 opacity-0" : "animate-ping motion-reduce:animate-none opacity-30"
            }`}
            style={{ animationDuration: "2s" }}
          />
          {/* Mid ring */}
          <div className={`absolute w-20 h-20 rounded-full bg-brain-primary/5 blur-[8px] transition-all duration-500 motion-reduce:transition-none ${phase === "success" ? "scale-125" : ""}`} />
          {/* Icon container */}
          <div
            className={`relative w-16 h-16 rounded-2xl bg-brain-surface border border-brain-outline/20 flex items-center justify-center transition-all duration-500 motion-reduce:transition-none ${
              phase === "success"
                ? "bg-brain-secondary/10 border-brain-secondary/30 shadow-[0_0_32px_rgba(0,227,253,0.2)]"
                : "shadow-[0_0_24px_rgba(154,168,255,0.15)]"
            }`}
          >
            <span
              className={`material-symbols-outlined text-3xl transition-colors duration-500 motion-reduce:transition-none ${
                phase === "success" ? "text-brain-secondary" : "text-brain-primary"
              }`}
            >
              psychology
            </span>
          </div>
        </div>

        {/* Text */}
        <div className="space-y-2">
          <h2 className="font-headline text-2xl font-semibold tracking-tight text-white">
            {phase === "success" ? "Welcome back" : "Connecting your brain"}
          </h2>
          <p className="text-sm font-label text-brain-muted">
            {phase === "success" ? "Taking you to your neural network…" : "Verifying your identity…"}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex gap-2 items-center h-4">
          {phase === "loading" ? (
            [0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-brain-primary/50 animate-bounce motion-reduce:animate-none"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))
          ) : (
            <div className="flex items-center gap-1.5 text-brain-secondary">
              <span className="material-symbols-outlined text-base">check_circle</span>
              <span className="text-xs font-label">Authenticated</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
