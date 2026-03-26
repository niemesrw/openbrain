import { useState, useRef, useEffect, type KeyboardEvent } from "react";

interface BrainInputProps {
  onSubmit: (text: string) => void;
  loading: boolean;
}

export function BrainInput({ onSubmit, loading }: BrainInputProps) {
  const [value, setValue] = useState("");
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
    onSubmit(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent pt-6 pb-4 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative bg-gray-900 border border-gray-700 rounded-2xl focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-colors">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your brain something, or tell it what you're thinking..."
            rows={1}
            className="w-full bg-transparent text-white text-base placeholder-gray-500 px-4 py-3 pr-12 resize-none focus:outline-none rounded-2xl"
          />
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || loading}
            className="absolute right-2 bottom-2 p-2 rounded-xl bg-blue-600 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
          >
            {loading ? (
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-center text-xs text-gray-600 mt-2">
          Talk to your brain...
        </p>
      </div>
    </div>
  );
}
