import { useState, useRef, useEffect } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  onClear: () => void;
  loading: boolean;
}

export function SearchBar({ onSearch, onClear, loading }: SearchBarProps) {
  const [value, setValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (text: string) => {
    setValue(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!text.trim()) {
      onClear();
      return;
    }
    timerRef.current = setTimeout(() => onSearch(text.trim()), 300);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim()) onSearch(value.trim());
  };

  const handleClear = () => {
    setValue("");
    if (timerRef.current) clearTimeout(timerRef.current);
    onClear();
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brain-muted/50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search your brain..."
          className="w-full bg-brain-surface rounded-xl pl-12 pr-20 py-3 text-white text-lg placeholder-brain-muted/50 focus:outline-none focus:ring-1 focus:ring-brain-primary/50 transition-all"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {loading && (
            <svg
              className="animate-spin w-5 h-5 text-brain-secondary"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="text-brain-muted/50 hover:text-brain-muted transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
