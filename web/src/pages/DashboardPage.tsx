import { useState, useEffect, useRef, useMemo } from "react";
import { useChat } from "ai/react";
import {
  browseRecent,
  searchThoughts,
  getStats,
  captureThought,
  updateThought,
  deleteThought,
} from "../lib/brain-api";
import { getInsight, type InsightData } from "../lib/api";
import { getIdToken } from "../lib/auth";
import type { Thought, BrainStats, Scope } from "../lib/brain-types";
import { ErrorAlert } from "../components/ErrorAlert";
import { ThoughtCard } from "../components/ThoughtCard";
import { BrainInput } from "../components/BrainInput";
import { InsightCard } from "../components/InsightCard";
import { SearchBar } from "../components/SearchBar";

const CHAT_URL = import.meta.env.VITE_CHAT_URL ?? "";

const SUGGESTION_CHIPS = [
  "What patterns do you see?",
  "Summarize recent ideas",
  "What should I focus on?",
];

// --- Neural visualization ---
function NeuralViz({ topics }: { topics: string[] }) {
  const nodes = topics.slice(0, 6);
  const positions = [
    { x: 50, y: 12 },
    { x: 84, y: 32 },
    { x: 84, y: 68 },
    { x: 50, y: 88 },
    { x: 16, y: 68 },
    { x: 16, y: 32 },
  ];

  return (
    <div className="relative w-full max-w-[240px] mx-auto aspect-square my-4">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-32 h-32 bg-brain-secondary/5 rounded-full blur-[60px]" />
      </div>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
        {nodes.map((_, i) => (
          <line
            key={i}
            x1="50" y1="50"
            x2={positions[i].x} y2={positions[i].y}
            stroke="#484847"
            strokeWidth="0.6"
            strokeDasharray="2 2"
            opacity="0.5"
          />
        ))}
      </svg>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-brain-secondary/10 flex items-center justify-center neural-glow z-10">
        <span className="material-symbols-outlined text-brain-secondary text-xl">psychology</span>
      </div>
      {nodes.map((topic, i) => (
        <div
          key={topic}
          className="absolute flex flex-col items-center gap-0.5"
          style={{ left: `${positions[i].x}%`, top: `${positions[i].y}%`, transform: "translate(-50%, -50%)" }}
        >
          <div className="w-5 h-5 rounded-full bg-brain-high border border-brain-outline/20 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-brain-primary/60" />
          </div>
          <span className="text-[8px] font-label text-brain-muted/50 whitespace-nowrap max-w-[56px] truncate text-center leading-tight">
            {topic}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Concept card ---
function ConceptCard({ topic, count, onClick }: { topic: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-brain-surface hover:bg-brain-high p-4 rounded-xl flex items-center gap-3 group transition-all active:scale-[0.98] text-left"
    >
      <div className="w-9 h-9 rounded-lg bg-brain-high group-hover:bg-brain-highest flex items-center justify-center shrink-0 transition-colors">
        <span className="material-symbols-outlined text-brain-muted text-base">tag</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{topic}</p>
        <p className="text-[10px] font-label text-brain-muted/60 uppercase tracking-widest mt-0.5">{count} thought{count !== 1 ? "s" : ""}</p>
      </div>
      <span className="material-symbols-outlined text-brain-muted/30 group-hover:text-brain-secondary text-base transition-colors">
        arrow_forward_ios
      </span>
    </button>
  );
}

export function DashboardPage() {
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [recentThoughts, setRecentThoughts] = useState<Thought[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(false);
  const [mode, setMode] = useState<"browse" | "chat">("browse");
  const [browseStale, setBrowseStale] = useState(true);
  const [humanOnly, setHumanOnly] = useState(true);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Thought[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchIdRef = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const { messages, input, handleInputChange, handleSubmit: chatHandleSubmit, isLoading: chatLoading, setMessages, stop } = useChat({
    api: CHAT_URL,
    fetch: async (url, init) => {
      const token = await getIdToken();
      return fetch(url, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          Authorization: `Bearer ${token}`,
        },
      });
    },
    onFinish: () => {
      setBrowseStale(true);
      getStats().then(setStats).catch(() => {});
    },
  });

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
    getInsight().then(setInsight).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== "browse" || !browseStale) return;
    const id = ++requestIdRef.current;
    setBrowseLoading(true);
    browseRecent({ topic: activeTopic || undefined, limit: limit + 1, human_only: humanOnly || undefined, scope: humanOnly ? "private" : "all" })
      .then((results) => {
        if (id !== requestIdRef.current) return;
        setHasMore(results.length > limit);
        setRecentThoughts(results.slice(0, limit));
        setBrowseStale(false);
      })
      .catch(() => { if (id === requestIdRef.current) setRecentThoughts([]); })
      .finally(() => { if (id === requestIdRef.current) setBrowseLoading(false); });
  }, [activeTopic, humanOnly, limit, mode, browseStale]);

  // Debounced semantic search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    const id = ++searchIdRef.current;
    setSearchLoading(true);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchThoughts(searchQuery, { limit: 20 })
        .then((results) => { if (id === searchIdRef.current) setSearchResults(results); })
        .catch(() => { if (id === searchIdRef.current) setSearchResults([]); })
        .finally(() => { if (id === searchIdRef.current) setSearchLoading(false); });
    }, 400);
    return () => clearTimeout(searchTimerRef.current);
  }, [searchQuery]);

  useEffect(() => {
    if (mode === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, mode]);

  const handleChatSubmit = () => {
    if (!input.trim() || chatLoading) return;
    setMode("chat");
    chatHandleSubmit({ preventDefault: () => {} } as React.FormEvent<HTMLFormElement>);
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setSearchLoading(true);
    try {
      const results = await searchThoughts(query);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchClear = () => {
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleCapture = async (text: string, scope: Scope, type?: string) => {
    setCaptureLoading(true);
    setCaptureError(null);
    setCaptureSuccess(false);
    try {
      await captureThought(text, scope, type);
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 3000);
      setMode("browse");
      setBrowseStale(true);
      getStats().then(setStats).catch(() => {});
    } catch (e: unknown) {
      setCaptureError(e instanceof Error ? e.message : String(e));
    } finally {
      setCaptureLoading(false);
    }
  };

  const handleTopicChange = (topic: string | null) => {
    setLimit(20);
    setBrowseStale(true);
    setActiveTopic(topic);
    setSearchQuery("");
  };

  const handleEditThought = async (id: string, text: string, scope: Scope) => {
    await updateThought(id, text, scope);
    setRecentThoughts((thoughts) => thoughts.map((t) => (t.id === id ? { ...t, content: text } : t)));
  };

  const handleDeleteThought = async (id: string, scope: Scope) => {
    await deleteThought(id, scope);
    setRecentThoughts((thoughts) => thoughts.filter((t) => t.id !== id));
  };

  const handleBackToBrowse = () => {
    stop();
    setMode("browse");
    setMessages([]);
  };

  const handleInsightExplore = (topic: string) => {
    setInsightDismissed(true);
    setMode("browse");
    setLimit(20);
    setBrowseStale(true);
    setActiveTopic(topic);
  };

  const handleSuggestionChip = (text: string) => {
    handleInputChange({ target: { value: text } } as React.ChangeEvent<HTMLTextAreaElement>);
  };

  const topTopics = useMemo(
    () =>
      stats
        ? Object.entries(stats.topics)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([t]) => t)
        : [],
    [stats],
  );

  const hasFilters = !!activeTopic;

  return (
    <div className="pb-32 pt-4">

      {/* ===== BROWSE / DISCOVERY MODE ===== */}
      {mode !== "chat" && (
        <>
          {/* Hero */}
          <div className="mb-6">
            {stats && (
              <p className="text-[10px] font-label text-brain-muted uppercase tracking-widest mb-2">
                {stats.total} thought{stats.total !== 1 ? "s" : ""} stored
              </p>
            )}
            <h1 className="font-headline text-3xl font-bold tracking-tight mb-4 leading-tight">
              Expand Your<br />Neural Network
            </h1>

            {/* Search bar */}
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-brain-muted/50 text-xl pointer-events-none">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your brain..."
                className="w-full bg-brain-surface text-white placeholder-brain-muted/50 rounded-xl pl-10 pr-10 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-brain-secondary/50 transition-all font-body"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-brain-muted/50 hover:text-brain-muted transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              )}
            </div>
          </div>

          {/* ---- SEARCH RESULTS ---- */}
          {searchQuery ? (
            <div className="space-y-3">
              {searchLoading && (
                <>
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="bg-brain-surface rounded-xl h-20 animate-pulse" />
                  ))}
                </>
              )}
              {!searchLoading && searchResults.length === 0 && (
                <p className="text-brain-muted/60 text-center py-8 font-label text-sm">
                  No results for "{searchQuery}"
                </p>
              )}
              {!searchLoading && searchResults.map((t, i) => (
                <ThoughtCard
                  key={t.id ?? String(t.created_at ?? i)}
                  thought={t}
                  onUpdate={handleEditThought}
                  onDelete={handleDeleteThought}
                />
              ))}
            </div>
          ) : (
            <>
              {/* Insight card */}
              {insight && !insightDismissed && (
                <InsightCard
                  insight={insight}
                  onExplore={handleInsightExplore}
                  onDismiss={() => setInsightDismissed(true)}
                />
              )}

              {/* Neural viz + concept cards (no active filter) */}
              {!hasFilters && topTopics.length > 0 && (
                <>
                  <NeuralViz topics={topTopics} />
                  <p className="text-[10px] font-label text-brain-muted uppercase tracking-widest mb-3">
                    Top Concepts
                  </p>
                  <div className="space-y-2 mb-6">
                    {topTopics.slice(0, 5).map((topic) => (
                      <ConceptCard
                        key={topic}
                        topic={topic}
                        count={stats?.topics[topic] ?? 0}
                        onClick={() => handleTopicChange(topic)}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Active filter pill + clear */}
              {hasFilters && (
                <div className="flex items-center gap-2 mb-4">
                  {activeTopic && (
                    <span className="px-3 py-1 rounded-full text-xs font-label bg-brain-secondary/10 text-brain-secondary">
                      #{activeTopic}
                    </span>
                  )}
                  <button
                    onClick={() => { setActiveTopic(null); setLimit(20); setBrowseStale(true); }}
                    className="text-xs font-label text-brain-muted/60 hover:text-brain-muted transition-colors ml-1"
                  >
                    Clear ×
                  </button>
                </div>
              )}

              {/* Recent thoughts */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-label text-brain-muted uppercase tracking-widest">
                  {hasFilters ? "Filtered" : "Recent"}
                </p>
                <div className="flex items-center gap-2">
                  {browseLoading && (
                    <div className="w-3 h-3 border border-brain-muted/30 border-t-brain-muted rounded-full animate-spin" />
                  )}
                  <button
                    onClick={() => { setHumanOnly((v) => !v); setBrowseStale(true); }}
                    className={`text-[10px] font-label px-2 py-0.5 rounded-full transition-colors ${
                      humanOnly
                        ? "bg-brain-primary/15 text-brain-primary"
                        : "bg-brain-surface text-brain-muted hover:text-white"
                    }`}
                    title={humanOnly ? "Showing your captures only — click to include agent activity" : "Showing all including agent activity — click to hide"}
                  >
                    {humanOnly ? "Mine" : "All"}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {!browseLoading && recentThoughts.length === 0 && (
                  <p className="text-brain-muted/60 text-center py-8 font-label text-sm">
                    No thoughts yet. Start by telling your brain something below.
                  </p>
                )}
                {recentThoughts.map((t, i) => (
                  <ThoughtCard
                    key={`${t.created_at}-${i}`}
                    thought={t}
                    onUpdate={handleEditThought}
                    onDelete={handleDeleteThought}
                  />
                ))}
              </div>

              {hasMore && (
                <button
                  onClick={() => { setLimit((l) => l + 20); setBrowseStale(true); }}
                  className="w-full mt-3 py-2 text-sm text-brain-muted hover:text-white bg-brain-surface hover:bg-brain-high rounded-xl font-label transition-colors"
                >
                  Load more
                </button>
              )}
            </>
          )}
        </>
      )}

      {/* ===== CHAT MODE ===== */}
      {mode === "chat" && (
        <>
          {/* Atmospheric glow */}
          <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-brain-primary/5 rounded-full blur-[120px]" />
            <div className="absolute bottom-40 left-0 w-80 h-80 bg-brain-secondary/5 rounded-full blur-[100px]" />
          </div>

          <button
            onClick={handleBackToBrowse}
            className="mt-2 mb-6 text-sm text-brain-muted/60 hover:text-brain-muted flex items-center gap-1 font-label transition-colors"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Discovery
          </button>

          <div className="space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "user" ? (
                  <div className="max-w-[85%] bg-brain-highest rounded-2xl rounded-tr-none border-l-2 border-brain-primary/30 px-4 py-3">
                    <p className="text-sm text-white/90 whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-[10px] font-label text-brain-muted/40 uppercase tracking-widest mt-2">You</p>
                  </div>
                ) : (
                  <div className="max-w-[90%] space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <div className="w-5 h-5 rounded bg-brain-secondary/10 flex items-center justify-center">
                        <span className="material-symbols-outlined text-brain-secondary" style={{ fontSize: "12px" }}>psychology</span>
                      </div>
                      <span className="text-[10px] font-label text-brain-secondary uppercase tracking-widest">Brain</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-brain-secondary animate-pulse" />
                    </div>
                    <div className="relative bg-brain-low rounded-3xl rounded-tl-none px-4 py-3 overflow-hidden">
                      <div className="absolute -top-4 -left-4 w-24 h-24 bg-brain-secondary/5 rounded-full blur-[30px] pointer-events-none" />
                      <p className="relative text-sm text-white/80 whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-brain-low rounded-3xl rounded-tl-none px-4 py-3">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-brain-secondary/50 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Suggestion chips after last AI message */}
            {!chatLoading && messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && (
              <div className="flex flex-wrap gap-2 pl-1">
                {SUGGESTION_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => handleSuggestionChip(chip)}
                    className="px-3 py-1.5 rounded-full text-xs font-label bg-brain-surface hover:bg-brain-high text-brain-muted hover:text-white transition-all border border-brain-outline/15"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </>
      )}

      {/* Toasts */}
      {captureSuccess && (
        <div className="fixed bottom-36 left-0 right-0 flex justify-center pointer-events-none z-10">
          <div className="bg-brain-secondary/20 text-brain-secondary px-4 py-2 rounded-xl text-sm shadow-lg font-label neural-glow">
            Thought captured
          </div>
        </div>
      )}
      {captureError && (
        <div className="fixed bottom-36 left-0 right-0 flex justify-center z-10">
          <ErrorAlert message={captureError} className="cursor-pointer" onClick={() => setCaptureError(null)} />
        </div>
      )}

      <BrainInput
        chatValue={input}
        onChatChange={handleInputChange}
        onChatSubmit={handleChatSubmit}
        onCapture={handleCapture}
        loading={chatLoading || captureLoading}
      />
    </div>
  );
}
