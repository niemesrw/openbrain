import { useState, useEffect, useCallback, useRef } from "react";
import { browseRecent } from "../lib/brain-api";
import type { Thought } from "../lib/brain-types";
import { TYPE_COLORS } from "../lib/type-colors";
import ReactMarkdown from "react-markdown";

type Segment = "private" | "shared";

function relativeTime(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Segmented control pill
function Segment({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 text-sm font-label font-medium rounded-full transition-all ${
        active
          ? "bg-brain-surface text-brain-secondary shadow-[0_0_12px_rgba(0,227,253,0.2)]"
          : "text-brain-muted hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

// Feed card
function FeedCard({ thought, scope }: { thought: Thought; scope: Segment }) {
  const [expanded, setExpanded] = useState(false);
  const color = TYPE_COLORS[thought.type] ?? "#adaaaa";
  const borderColor = scope === "private" ? "border-brain-secondary/40" : "border-brain-primary/40";
  const content = thought.content;
  const isLong = content.length > 200;

  return (
    <div className={`bg-brain-surface rounded-xl overflow-hidden border-l-2 ${borderColor}`}>
      <div className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {scope === "shared" && (
              <div className="w-7 h-7 rounded-full bg-brain-high flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-brain-muted text-sm">person</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-label uppercase tracking-widest truncate" style={{ color }}>
                {thought.type.replace("_", " ")}
              </p>
              <p className="text-[10px] font-label text-brain-muted/50 mt-0.5">
                {relativeTime(thought.created_at)}
                {scope === "shared" && thought.scope === "shared" && (
                  <span className="ml-1 text-brain-secondary/60">· shared</span>
                )}
              </p>
            </div>
          </div>

        </div>

        {/* Content */}
        <div className={`text-sm text-white/80 ${!expanded && isLong ? "line-clamp-3" : ""} prose prose-invert prose-sm max-w-none prose-p:my-1 prose-li:my-0`}>
          <ReactMarkdown>{expanded || !isLong ? content : content.slice(0, 200) + "…"}</ReactMarkdown>
        </div>
        {isLong && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-[10px] font-label text-brain-muted/60 hover:text-brain-muted uppercase tracking-widest transition-colors"
          >
            {expanded ? "Show less ↑" : "Show more ↓"}
          </button>
        )}

        {/* Topics + people */}
        {(thought.topics.length > 0 || thought.people.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {thought.topics.map((t) => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-brain-secondary/10 text-brain-secondary font-label">
                {t}
              </span>
            ))}
            {thought.people.map((p) => (
              <span key={p} className="text-[10px] px-2 py-0.5 rounded-full bg-brain-primary/10 text-brain-primary font-label">
                @{p}
              </span>
            ))}
          </div>
        )}

        {/* Media */}
        {thought.media_url && (
          <div className="rounded-lg overflow-hidden">
            <img
              src={thought.media_url}
              alt=""
              className="w-full max-h-48 object-cover rounded-lg"
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Skeleton loader
function SkeletonCard() {
  return (
    <div className="bg-brain-surface rounded-xl border-l-2 border-brain-outline/20 p-4 space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-brain-high" />
        <div className="space-y-1">
          <div className="w-16 h-2 rounded bg-brain-high" />
          <div className="w-10 h-2 rounded bg-brain-high" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="w-full h-3 rounded bg-brain-high" />
        <div className="w-4/5 h-3 rounded bg-brain-high" />
        <div className="w-3/5 h-3 rounded bg-brain-high" />
      </div>
      <div className="flex gap-2">
        <div className="w-12 h-4 rounded-full bg-brain-high" />
        <div className="w-16 h-4 rounded-full bg-brain-high" />
      </div>
    </div>
  );
}

export function FeedPage() {
  const [segment, setSegment] = useState<Segment>("private");
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadFeed = useCallback(async (scope: Segment) => {
    const id = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const results = await browseRecent({ scope, limit: 50 });
      if (id !== requestIdRef.current) return;
      setThoughts(results);
    } catch (e: unknown) {
      if (id !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setThoughts([]);
    loadFeed(segment);
  }, [segment, loadFeed]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadFeed(segment);
    }, 30_000);
    return () => clearInterval(interval);
  }, [segment, loadFeed]);

  return (
    <div className="pt-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-headline text-3xl font-bold tracking-tight">Thoughts</h1>
        <button
          onClick={() => loadFeed(segment)}
          disabled={loading}
          aria-label="Refresh"
          title="Refresh"
          aria-busy={loading}
          className="text-sm text-brain-muted hover:text-white disabled:opacity-40 font-label transition-colors"
        >
          {loading ? (
            <div className="w-4 h-4 border border-brain-muted/30 border-t-brain-muted rounded-full animate-spin" aria-hidden="true" />
          ) : (
            <span className="material-symbols-outlined text-xl" aria-hidden="true">refresh</span>
          )}
        </button>
      </div>

      {/* Segmented control */}
      <div className="bg-brain-low rounded-full p-1 flex gap-1">
        <Segment active={segment === "private"} label="My Brain" onClick={() => setSegment("private")} />
        <Segment active={segment === "shared"} label="Global Feed" onClick={() => setSegment("shared")} />
      </div>

      {error && (
        <p className="text-brain-error text-sm font-label">{error}</p>
      )}

      {/* Cards */}
      <div className="space-y-4">
        {loading && thoughts.length === 0 && (
          <>
            {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
          </>
        )}

        {!loading && thoughts.length === 0 && !error && (
          <div className="text-center py-12 space-y-2">
            <span className="material-symbols-outlined text-brain-muted/30 text-4xl block">
              {segment === "private" ? "psychology" : "public"}
            </span>
            <p className="text-brain-muted/60 font-label text-sm">
              {segment === "private"
                ? "No thoughts captured yet."
                : "No shared thoughts yet."}
            </p>
          </div>
        )}

        {thoughts.map((t, i) => (
          <FeedCard key={t.id ?? String(t.created_at ?? i)} thought={t} scope={segment} />
        ))}
      </div>
    </div>
  );
}
