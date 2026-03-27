import { useState, useEffect, useRef } from "react";
import { getIdToken, getApiUrl } from "../lib/auth";

interface LinkResult {
  code: string;
  expiresAt: number;
}

async function requestTelegramLink(): Promise<LinkResult> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/telegram/link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to generate code: ${res.status}`);
  return res.json();
}

export function TelegramConnect() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCountdown(expiresAt: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0 && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
  }

  async function generate() {
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const data = await requestTelegramLink();
      setResult(data);
      startCountdown(data.expiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate code");
    } finally {
      setLoading(false);
    }
  }

  async function copyCode() {
    if (!result) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.code);
      } else {
        // Fallback for non-secure contexts or browsers without Clipboard API
        const textarea = document.createElement("textarea");
        textarea.value = result.code;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy — please copy the code manually.");
    }
  }

  const expired = result && secondsLeft === 0;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.868l-2.967-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.985.691z"/>
        </svg>
        <h3 className="text-sm font-medium text-gray-200">Connect Telegram</h3>
      </div>

      <p className="text-xs text-gray-400">
        Link your Telegram account to capture thoughts, search, and get insights on the go.
      </p>

      {!result || expired ? (
        <button
          onClick={generate}
          disabled={loading}
          className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:text-blue-400 text-white text-sm rounded transition-colors"
        >
          {loading ? "Generating…" : expired ? "Generate new code" : "Generate link code"}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Send this command to your Telegram bot:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-800 text-blue-300 text-sm font-mono px-3 py-2 rounded border border-gray-700 tracking-widest">
              /link {result.code}
            </code>
            <button
              onClick={copyCode}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className={`text-xs ${secondsLeft < 60 ? "text-orange-400" : "text-gray-500"}`}>
            Expires in {minutes}:{String(seconds).padStart(2, "0")}
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <p className="text-xs text-gray-600">
        Don't have the bot yet?{" "}
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-400"
        >
          Set up with BotFather
        </a>
      </p>
    </div>
  );
}
