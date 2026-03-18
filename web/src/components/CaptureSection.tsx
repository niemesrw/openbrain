import { useState } from "react";
import { captureThought } from "../lib/brain-api";

const TYPES = [
  "observation",
  "task",
  "idea",
  "reference",
  "person_note",
] as const;

interface CaptureSectionProps {
  onCaptured?: () => void;
}

export function CaptureSection({ onCaptured }: CaptureSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<"private" | "shared">("private");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError("Please enter a thought.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await captureThought(text.trim(), {
        scope,
        type: selectedType ?? undefined,
      });
      setResult(res);
      setText("");
      setSelectedType(null);
      onCaptured?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture thought.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => {
          setExpanded((v) => !v);
          setResult(null);
          setError(null);
        }}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-200 hover:bg-gray-900 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-blue-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Capture a thought
        </span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4 space-y-4 bg-gray-950">
          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What's on your mind? Capture a decision, insight, task, or note..."
              rows={4}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500"
              disabled={loading}
            />

            <div className="flex flex-wrap gap-3 items-center">
              {/* Scope toggle */}
              <div className="flex rounded overflow-hidden border border-gray-700 text-xs">
                {(["private", "shared"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={`px-3 py-1.5 capitalize transition-colors ${
                      scope === s
                        ? "bg-blue-600 text-white"
                        : "bg-gray-900 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {s === "private" ? "🔒 Private" : "🌐 Shared"}
                  </button>
                ))}
              </div>

              {/* Type selector */}
              <div className="flex flex-wrap gap-1">
                {TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelectedType(selectedType === t ? null : t)}
                    className={`px-2 py-1 rounded text-xs capitalize transition-colors ${
                      selectedType === t
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {t.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {selectedType
                  ? `Type: ${selectedType.replace("_", " ")}`
                  : "Type auto-detected"}
              </span>
              <button
                type="submit"
                disabled={loading || !text.trim()}
                className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Capturing..." : "Capture"}
              </button>
            </div>
          </form>

          {error && (
            <p className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded px-3 py-2">
              {error}
            </p>
          )}

          {result && (
            <pre className="bg-gray-900 rounded p-3 text-xs text-green-300 whitespace-pre-wrap border border-gray-800">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
