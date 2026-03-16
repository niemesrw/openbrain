import { useState, useEffect, useCallback } from "react";
import { callTool } from "../lib/api";

export function FeedPage() {
  const [activity, setActivity] = useState("");
  const [loading, setLoading] = useState(true);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callTool("bus_activity", { hours: 24, limit: 50 });
      setActivity(result);
    } catch (e: any) {
      setActivity(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, 30_000);
    return () => clearInterval(interval);
  }, [loadActivity]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Public Feed</h1>
        <button
          onClick={loadActivity}
          disabled={loading}
          className="text-sm text-gray-400 hover:text-white disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <pre className="bg-gray-900 rounded p-4 text-sm text-gray-300 whitespace-pre-wrap">
        {activity || "Loading..."}
      </pre>
    </div>
  );
}
