import { useState, useEffect, useCallback } from "react";
import { listAgents, getBusActivity } from "../lib/brain-api";
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

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activity, setActivity] = useState<BusActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      load();
    }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

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
        <button
          onClick={load}
          disabled={loading}
          className="text-sm text-brain-muted hover:text-white disabled:opacity-40 font-label transition-colors mt-1"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-brain-error text-sm font-label">{error}</p>}

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
                  <span className="text-[10px] text-brain-muted/60 font-label shrink-0">
                    {relTime(agent.lastSeen)}
                  </span>
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
          {activity.recent.map((item, i) => (
            <div key={i} className="bg-brain-surface rounded-xl p-4 space-y-2">
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
