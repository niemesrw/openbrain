import { useState, useEffect, useCallback, useRef } from "react";
import { listAgents, getBusActivity, createAgent, revokeAgent } from "../lib/brain-api";
import type { Agent, BusActivity } from "../lib/brain-types";

const STATUS_COLOR: Record<string, string> = {
  working: "text-brain-secondary",
  idle: "text-brain-muted",
  error: "text-brain-error",
  stale: "text-brain-tertiary",
  unknown: "text-brain-muted",
};

const ACCENTS = [
  { bar: "bg-brain-secondary", text: "text-brain-secondary", shadow: "shadow-[0_0_10px_rgba(0,227,253,0.5)]", bg: "bg-brain-secondary/10" },
  { bar: "bg-brain-tertiary",  text: "text-brain-tertiary",  shadow: "shadow-[0_0_10px_rgba(166,140,255,0.4)]", bg: "bg-brain-tertiary/10" },
  { bar: "bg-brain-primary",   text: "text-brain-primary",   shadow: "shadow-[0_0_10px_rgba(154,168,255,0.4)]", bg: "bg-brain-primary/10" },
];

function relTime(ts: string | null): string {
  if (!ts) return "never";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Parse the createAgent plain-text response to extract key and CLI snippet. */
function parseCreateResponse(text: string): { apiKey: string; cliSnippet: string } | null {
  const keyMatch = text.match(/API Key:\s*(ob_\S+)/);
  const cliMatch = text.match(/claude mcp add[^\n]+/);
  if (!keyMatch) return null;
  return {
    apiKey: keyMatch[1],
    cliSnippet: cliMatch ? cliMatch[0].trim() : "",
  };
}

interface NewKeyInfo {
  agentName: string;
  apiKey: string;
  cliSnippet: string;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activity, setActivity] = useState<BusActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isLoadingRef = useRef(false);

  // Create flow
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<NewKeyInfo | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);

  // Revoke flow
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [agentList, bus] = await Promise.all([
        listAgents(),
        getBusActivity({ hours: 24, limit: 20 }),
      ]);
      setAgents(agentList);
      setActivity(bus);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      isLoadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // bus_activity does a full index scan — poll at 60s to limit cost
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      load();
    }, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await createAgent(name);
      const parsed = parseCreateResponse(response);
      if (!parsed) {
        setCreateError(response.startsWith("Error:") ? response : "Unexpected response from server.");
        return;
      }
      setNewKey({ agentName: name, ...parsed });
      setNewName("");
      setShowCreate(false);
      await load();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (name: string) => {
    setRevoking(true);
    try {
      await revokeAgent(name);
      setConfirmRevoke(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevoking(false);
    }
  };

  const copyToClipboard = (text: string, which: "key" | "cli") => {
    const set = which === "key" ? setCopiedKey : setCopiedCli;
    navigator.clipboard.writeText(text).then(() => {
      set(true);
      setTimeout(() => set(false), 2000);
    });
  };

  const activeCount = agents.filter((a) => a.status === "working").length;

  return (
    <div className="space-y-6 pt-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Agent Activities</h1>
          <p className="text-[10px] font-label font-bold text-brain-muted uppercase tracking-widest mt-1">
            {loading ? "Loading…" : `${activeCount} active · ${agents.length} registered`}
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <button
            onClick={() => { setShowCreate((v) => !v); setCreateError(null); setNewName(""); }}
            className="text-sm text-brain-primary hover:text-white font-label transition-colors"
          >
            {showCreate ? "Cancel" : "+ New Agent"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="text-sm text-brain-muted hover:text-white disabled:opacity-40 font-label transition-colors"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="text-brain-error text-sm font-label">{error}</p>}

      {/* Create form */}
      {showCreate && (
        <div className="glass-card rounded-2xl p-5 border border-brain-primary/20 space-y-3">
          <p className="text-[10px] font-label font-bold text-brain-primary uppercase tracking-widest">
            New Agent
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="agent-name (alphanumeric, hyphens, underscores)"
              className="flex-1 bg-brain-surface rounded-xl px-4 py-2 text-sm text-white placeholder:text-brain-muted/50 outline-none border border-brain-outline/10 focus:border-brain-primary/40 transition-colors"
              disabled={creating}
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-5 py-2 rounded-xl bg-brain-primary/20 text-brain-primary text-sm font-label font-bold hover:bg-brain-primary/30 disabled:opacity-40 transition-colors"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
          {createError && (
            <p className="text-brain-error text-xs font-label">{createError}</p>
          )}
        </div>
      )}

      {/* New key reveal panel — shown once after creation */}
      {newKey && (
        <div className="glass-card rounded-2xl p-5 border border-brain-secondary/30 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-label font-bold text-brain-secondary uppercase tracking-widest">
              Agent "{newKey.agentName}" Created
            </p>
            <button
              onClick={() => setNewKey(null)}
              className="text-brain-muted/60 hover:text-white text-sm font-label transition-colors"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-brain-muted font-label">
            Copy your API key now — it will not be shown again.
          </p>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-brain-surface rounded-xl px-4 py-2 text-xs text-brain-secondary font-mono break-all">
              {newKey.apiKey}
            </code>
            <button
              onClick={() => copyToClipboard(newKey.apiKey, "key")}
              className="shrink-0 px-4 py-2 rounded-xl bg-brain-secondary/10 text-brain-secondary text-xs font-label hover:bg-brain-secondary/20 transition-colors"
            >
              {copiedKey ? "Copied!" : "Copy"}
            </button>
          </div>
          {newKey.cliSnippet && (
            <div className="space-y-1">
              <p className="text-[10px] font-label text-brain-muted uppercase tracking-widest">
                Claude Code setup
              </p>
              <div className="flex items-center gap-3">
                <code className="flex-1 bg-brain-surface rounded-xl px-4 py-2 text-xs text-white/70 font-mono break-all">
                  {newKey.cliSnippet}
                </code>
                <button
                  onClick={() => copyToClipboard(newKey.cliSnippet, "cli")}
                  className="shrink-0 px-4 py-2 rounded-xl bg-brain-outline/10 text-brain-muted text-xs font-label hover:text-white hover:bg-brain-outline/20 transition-colors"
                >
                  {copiedCli ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Registered agents */}
      {loading && agents.length === 0 ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-brain-surface rounded-2xl h-24 animate-pulse" />
          ))}
        </div>
      ) : agents.length === 0 && !error ? (
        <p className="text-brain-muted/60 text-center py-8 font-label text-sm">
          No agents registered yet.
        </p>
      ) : (
        <div className="space-y-4">
          {agents.map((agent, i) => {
            const accent = ACCENTS[i % ACCENTS.length];
            const statusColor = STATUS_COLOR[agent.status] ?? "text-brain-muted";
            const isConfirming = confirmRevoke === agent.name;
            return (
              <div key={agent.name} className="relative glass-card rounded-2xl p-5 border border-brain-outline/10 overflow-hidden">
                <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${accent.bar} ${accent.shadow}`} />
                <div className="pl-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${accent.bg}`}>
                      <span className={`material-symbols-outlined text-xl ${accent.text}`}>smart_toy</span>
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-label font-bold uppercase tracking-widest truncate ${accent.text}`}>
                        {agent.name}
                      </p>
                      <p className={`text-[10px] font-label uppercase tracking-wide mt-0.5 ${statusColor}`}>
                        {agent.status}{agent.statusMessage ? ` · ${agent.statusMessage}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-brain-muted/60 font-label">
                      {relTime(agent.lastSeen)}
                    </span>
                    {isConfirming ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-label text-brain-error">Revoke?</span>
                        <button
                          onClick={() => handleRevoke(agent.name)}
                          disabled={revoking}
                          className="text-[10px] px-3 py-1 rounded-lg bg-brain-error/20 text-brain-error font-label hover:bg-brain-error/30 disabled:opacity-40 transition-colors"
                        >
                          {revoking ? "…" : "Yes"}
                        </button>
                        <button
                          onClick={() => setConfirmRevoke(null)}
                          disabled={revoking}
                          className="text-[10px] px-3 py-1 rounded-lg bg-brain-outline/10 text-brain-muted font-label hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRevoke(agent.name)}
                        className="text-[10px] text-brain-muted/50 hover:text-brain-error font-label transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent bus activity */}
      {activity && activity.recent.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-label font-bold text-brain-muted uppercase tracking-widest">
            Recent · {activity.summary.total} thoughts in {activity.summary.hours}h
          </p>
          {activity.recent.map((item) => (
            <div key={`${item.agent}-${item.created_at}-${item.content.slice(0, 16)}`} className="bg-brain-surface rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-label font-bold text-brain-secondary uppercase tracking-widest truncate">
                  {item.agent}
                </span>
                <span className="text-[10px] font-label text-brain-muted/60 shrink-0">
                  {relTime(item.created_at)}
                </span>
              </div>
              <p className="text-sm text-white/80 line-clamp-2">{item.content}</p>
              {item.topics.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.topics.map((t) => (
                    <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-brain-secondary/10 text-brain-secondary font-label">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
