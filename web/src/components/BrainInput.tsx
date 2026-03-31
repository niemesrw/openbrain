import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
import type { Scope } from "../lib/brain-types";

interface BrainInputProps {
  chatValue: string;
  onChatChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onChatSubmit: () => void;
  onCapture: (text: string, scope: Scope) => void;
  loading: boolean;
}

export function BrainInput({ chatValue, onChatChange, onChatSubmit, onCapture, loading }: BrainInputProps) {
  const [captureValue, setCaptureValue] = useState("");
  const [mode, setMode] = useState<"chat" | "capture">("chat");
  const [scope, setScope] = useState<Scope>("private");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isCapture = mode === "capture";
  const displayValue = isCapture ? captureValue : chatValue;

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [displayValue]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (isCapture) {
      setCaptureValue(e.target.value);
    } else {
      onChatChange(e);
    }
  };

  const handleSubmit = () => {
    if (!displayValue.trim() || loading) return;
    if (isCapture) {
      onCapture(captureValue.trim(), scope);
      setCaptureValue("");
    } else {
      onChatSubmit();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const placeholder = isCapture
    ? "Save a thought, decision, or note to your brain..."
    : "Ask your brain something, or tell it what you're thinking...";

  return (
    <div className="fixed left-0 right-0 glass-panel pt-4 pb-3 px-4" style={{ bottom: "var(--bottom-nav-height, 76px)" }}>
      <div className="max-w-3xl mx-auto">
        <div
          className={`relative bg-brain-surface rounded-2xl transition-all ${
            isCapture
              ? "ring-1 ring-brain-secondary/50"
              : "ring-1 ring-brain-outline/30 focus-within:ring-brain-primary/50"
          }`}
        >
          <textarea
            ref={textareaRef}
            value={displayValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="w-full bg-transparent text-white text-base placeholder-brain-muted/50 px-4 py-3 pr-12 resize-none focus:outline-none rounded-2xl"
          />
          <button
            onClick={handleSubmit}
            disabled={!displayValue.trim() || loading}
            className={`absolute right-2 bottom-2 p-2 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${
              isCapture
                ? "bg-brain-secondary hover:bg-brain-secondary-dim text-brain-secondary-on"
                : "bg-brain-primary hover:bg-brain-primary-dim text-brain-primary-on"
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
          <div className="flex items-center gap-1 bg-brain-surface rounded-lg p-0.5">
            <button
              onClick={() => setMode("chat")}
              className={`px-3 py-1 text-xs rounded-md transition-colors font-label ${
                !isCapture
                  ? "bg-brain-high text-white"
                  : "text-brain-muted/60 hover:text-brain-muted"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setMode("capture")}
              className={`px-3 py-1 text-xs rounded-md transition-colors font-label ${
                isCapture
                  ? "bg-brain-secondary/20 text-brain-secondary"
                  : "text-brain-muted/60 hover:text-brain-muted"
              }`}
            >
              Capture
            </button>
          </div>

          {isCapture && (
            <div className="flex items-center gap-1 bg-brain-surface rounded-lg p-0.5">
              <button
                onClick={() => setScope("private")}
                className={`px-3 py-1 text-xs rounded-md transition-colors font-label ${
                  scope === "private"
                    ? "bg-brain-high text-white"
                    : "text-brain-muted/60 hover:text-brain-muted"
                }`}
              >
                Private
              </button>
              <button
                onClick={() => setScope("shared")}
                className={`px-3 py-1 text-xs rounded-md transition-colors font-label ${
                  scope === "shared"
                    ? "bg-brain-secondary/20 text-brain-secondary"
                    : "text-brain-muted/60 hover:text-brain-muted"
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
