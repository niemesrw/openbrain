import { useState, useEffect, useCallback, useRef } from "react";
import { browseRecent } from "../lib/brain-api";
import type { Thought } from "../lib/brain-types";
import { ThoughtCard } from "../components/ThoughtCard";

export function FeedPage() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isLoadingRef = useRef(false);

  const loadFeed = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const results = await browseRecent({ scope: "shared", limit: 50 });
      setThoughts(results);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      isLoadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadFeed();
    }, 30_000);
    return () => clearInterval(interval);
  }, [loadFeed]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Public Feed</h1>
        <button
          onClick={loadFeed}
          disabled={loading}
          className="text-sm text-gray-400 hover:text-white disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {loading && thoughts.length === 0 && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-4 animate-pulse h-24" />
          ))}
        </div>
      )}

      {!loading && thoughts.length === 0 && !error && (
        <p className="text-gray-500 text-center py-8">
          No shared thoughts yet.
        </p>
      )}

      <div className="space-y-3">
        {/* TODO #117: agent attribution (display_name, agent_id) pending Thought type extension */}
        {thoughts.map((t, i) => (
          <ThoughtCard key={t.id ?? String(t.created_at ?? i)} thought={t} />
        ))}
      </div>
    </div>
  );
}
