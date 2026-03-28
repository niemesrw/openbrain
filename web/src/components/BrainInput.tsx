import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import type { Scope } from "../lib/brain-types";

interface BrainInputProps {
  onSubmit: (text: string) => void;
  onCapture: (text: string, scope: Scope) => void;
  loading: boolean;
}

export function BrainInput({ onSubmit, onCapture, loading }: BrainInputProps) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"chat" | "capture">("chat");
  const [scope, setScope] = useState<Scope>("private");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    if (mode === "capture") {
      onCapture(trimmed, scope);
    } else {
      onSubmit(trimmed);
    }
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isCapture = mode === "capture";
  const placeholder = isCapture
    ? "Save a thought, decision, or note to your brain..."
    : "Ask your brain something, or tell it what you're thinking...";

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent pt-6 pb-4 px-4">
      <div className="max-w-3xl mx-auto">
        <div
          className={`relative bg-gray-900 border rounded-2xl transition-colors focus-within:ring-1 ${
            isCapture
              ? "border-emerald-600 focus-within:border-emerald-500 focus-within:ring-emerald-500"
              : "border-gray-700 focus-within:border-blue-500 focus-within:ring-blue-500"
          }`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="w-full bg-transparent text-white text-base placeholder-gray-500 px-4 py-3 pr-12 resize-none focus:outline-none rounded-2xl"
          />
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || loading}
            className={`absolute right-2 bottom-2 p-2 rounded-xl text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${
              isCapture
                ? "bg-emerald-600 hover:bg-emerald-500"
                : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {loading ? (
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : isCapture ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>

        <div className="flex items-center justify-between mt-2 px-1">
          <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-0.5 border border-gray-800">
            <button
              onClick={() => setMode("chat")}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                !isCapture
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setMode("capture")}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                isCapture
                  ? "bg-emerald-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Capture
            </button>
          </div>

          {isCapture && (
            <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-0.5 border border-gray-800">
              <button
                onClick={() => setScope("private")}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  scope === "private"
                    ? "bg-gray-700 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Private
              </button>
              <button
                onClick={() => setScope("shared")}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  scope === "shared"
                    ? "bg-emerald-700 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                Shared
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
