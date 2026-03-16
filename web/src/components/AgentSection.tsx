import { useState, useEffect, useCallback } from "react";
import { listAgents, createAgent, revokeAgent } from "../lib/brain-api";
import type { Agent } from "../lib/brain-types";

export function AgentSection() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [newName, setNewName] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setAgents(await listAgents());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (expanded) load();
  }, [expanded, load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    setResult("");
    try {
      const res = await createAgent(newName.trim());
      setResult(res);
      setNewName("");
      load();
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (name: string) => {
    if (!confirm(`Revoke agent "${name}"?`)) return;
    try {
      await revokeAgent(name);
      load();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="border border-gray-800 rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left text-gray-400 hover:text-gray-200"
      >
        <span className="text-sm font-medium">
          Agents {agents.length > 0 && `(${agents.length})`}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-gray-800 p-4 space-y-4">
          {agents.length > 0 && (
            <ul className="space-y-2">
              {agents.map((a) => (
                <li key={a.name} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">
                    {a.name}{" "}
                    <span className="text-gray-600">
                      (created {new Date(a.createdAt).toLocaleDateString()})
                    </span>
                  </span>
                  <button
                    onClick={() => handleRevoke(a.name)}
                    className="text-red-500/60 hover:text-red-400 text-xs"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleCreate} className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New agent name"
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "..." : "Create"}
            </button>
          </form>
          {result && (
            <pre className="bg-gray-950 rounded p-3 text-xs text-green-300 whitespace-pre-wrap">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
