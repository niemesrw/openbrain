import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signUp, confirmSignUp, signIn } from "../lib/auth";
import { ErrorAlert } from "../components/ErrorAlert";

export function SignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"register" | "verify">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signUp(email, password, displayName);
      setStep("verify");
    } catch (err: any) {
      setError(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      await signIn(email, password);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full bg-brain-surface rounded-xl px-3 py-2.5 text-white placeholder-brain-muted/50 focus:outline-none focus:ring-1 focus:ring-brain-primary/50 transition-all";
  const labelClass = "block text-xs text-brain-muted font-label mb-1.5";

  return (
    <div className="max-w-md mx-auto">
      <h1 className="font-headline text-2xl font-semibold mb-2 tracking-tight">Create your account</h1>
      <p className="text-brain-muted text-sm font-label mb-8">Join the neural knowledge network</p>

      {error && <ErrorAlert message={error} />}

      {step === "register" ? (
        <form onSubmit={handleSignUp} className="space-y-4">
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Display name</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} className={inputClass} />
            <p className="text-xs text-brain-muted/40 font-label mt-1.5">
              Min 12 characters, uppercase, digit, and symbol required
            </p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brain-primary text-brain-primary-on font-label font-medium py-2.5 rounded-xl hover:bg-brain-primary-dim disabled:opacity-50 transition-colors"
          >
            {loading ? "Creating..." : "Sign up"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-4">
          <p className="text-brain-muted font-label text-sm">
            We sent a verification code to {email}
          </p>
          <div>
            <label className={labelClass}>Verification code</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brain-primary text-brain-primary-on font-label font-medium py-2.5 rounded-xl hover:bg-brain-primary-dim disabled:opacity-50 transition-colors"
          >
            {loading ? "Verifying..." : "Verify & log in"}
          </button>
        </form>
      )}
    </div>
  );
}
