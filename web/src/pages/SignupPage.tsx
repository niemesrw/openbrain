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

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create your account</h1>

      {error && <ErrorAlert message={error} />}

      {step === "register" ? (
        <form onSubmit={handleSignUp} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Display name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            />
            <p className="text-xs text-gray-500 mt-1">
              Min 12 characters, uppercase, digit, and symbol required
            </p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Sign up"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-4">
          <p className="text-gray-400">
            We sent a verification code to {email}
          </p>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Verification code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Verify & log in"}
          </button>
        </form>
      )}
    </div>
  );
}
