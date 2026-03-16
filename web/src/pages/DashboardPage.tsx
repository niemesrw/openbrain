import { useState, useEffect, useCallback } from "react";
import { callTool } from "../lib/api";

export function DashboardPage() {
  const [agents, setAgents] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [createResult, setCreateResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState("");

  const loadAgents = useCallback(async () => {
    try {
      const result = await callTool("list_agents");
      setAgents(result);
    } catch (e: any) {
      setAgents(`Error: ${e.message}`);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const result = await callTool("stats");
      setStats(result);
    } catch (e: any) {
      setStats(`Error: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    loadAgents();
    loadStats();
  }, [loadAgents, loadStats]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim()) return;
    setLoading(true);
    setCreateResult("");
    try {
      const result = await callTool("create_agent", {
        name: newAgentName.trim(),
      });
      setCreateResult(result);
      setNewAgentName("");
      loadAgents();
    } catch (e: any) {
      setCreateResult(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <section>
        <h2 className="text-lg font-semibold mb-3">Brain Stats</h2>
        <pre className="bg-gray-900 rounded p-4 text-sm text-gray-300 whitespace-pre-wrap">
          {stats || "Loading..."}
        </pre>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Your Agents</h2>
        <pre className="bg-gray-900 rounded p-4 text-sm text-gray-300 whitespace-pre-wrap">
          {agents || "Loading..."}
        </pre>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Create Agent</h2>
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            value={newAgentName}
            onChange={(e) => setNewAgentName(e.target.value)}
            placeholder="Agent name (e.g. claude-code)"
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </form>
        {createResult && (
          <pre className="bg-gray-900 rounded p-4 mt-3 text-sm text-green-300 whitespace-pre-wrap">
            {createResult}
          </pre>
        )}
      </section>
    </div>
  );
}
