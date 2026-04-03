import { useState, useEffect, useCallback } from "react";
import { listAgents, createAgent, revokeAgent } from "../lib/brain-api";
import type { Agent } from "../lib/brain-types";

function StatusDot({ status }: { status: Agent["status"] }) {
  const colors: Record<Agent["status"], string> = {
    working: "bg-brain-secondary",
    idle: "bg-yellow-400",
    error: "bg-brain-error",
    stale: "bg-brain-error",
    unknown: "bg-brain-muted",
  };
  const titles: Record<Agent["status"], string> = {
    working: "Active",
    idle: "Idle",
    error: "Error",
    stale: "Stale (>5 min)",
    unknown: "No heartbeat",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[status]}`}
      title={titles[status]}
    />
  );
}

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
    <div className="bg-brain-surface rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left text-brain-muted hover:text-white transition-colors font-label"
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
        <div className="border-t border-brain-outline/20 p-4 space-y-4">
          {agents.length > 0 && (
            <ul className="space-y-2">
              {agents.map((a) => (
                <li key={a.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-white/80 font-label">
                    <StatusDot status={a.status} />
                    <span>
                      {a.name}
                      {a.statusMessage && (
                        <span className="text-brain-muted/60 ml-1">— {a.statusMessage}</span>
                      )}
                      {" "}
                      <span className="text-brain-muted/40">
                        (created {new Date(a.createdAt).toLocaleDateString()})
                      </span>
                    </span>
                  </span>
                  <button
                    onClick={() => handleRevoke(a.name)}
                    className="text-brain-error/50 hover:text-brain-error text-xs font-label transition-colors"
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
              className="flex-1 bg-brain-high rounded-lg px-3 py-1.5 text-sm text-white placeholder-brain-muted/50 focus:outline-none focus:ring-1 focus:ring-brain-primary/50"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-brain-primary text-brain-primary-on text-sm font-label px-3 py-1.5 rounded-lg hover:bg-brain-primary-dim disabled:opacity-50 transition-colors"
            >
              {loading ? "..." : "Create"}
            </button>
          </form>
          {result && (
            <pre className="bg-brain-base rounded-lg p-3 text-xs text-brain-secondary whitespace-pre-wrap font-label">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
