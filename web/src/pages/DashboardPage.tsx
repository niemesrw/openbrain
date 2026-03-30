import { useState, useEffect, useRef, useMemo } from "react";
import { useChat } from "ai/react";
import {
  browseRecent,
  getStats,
  captureThought,
  updateThought,
  deleteThought,
} from "../lib/brain-api";
import { getInsight, type InsightData } from "../lib/api";
import { getIdToken } from "../lib/auth";
import type { Thought, BrainStats, Scope } from "../lib/brain-types";
import { ErrorAlert } from "../components/ErrorAlert";
import { FilterChips } from "../components/FilterChips";
import { ThoughtCard } from "../components/ThoughtCard";
import { StatsBar } from "../components/StatsBar";
import { BrainInput } from "../components/BrainInput";
import { InsightCard } from "../components/InsightCard";

const CHAT_URL = import.meta.env.VITE_CHAT_URL ?? "";

export function DashboardPage() {
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [recentThoughts, setRecentThoughts] = useState<Thought[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(false);
  const [mode, setMode] = useState<"browse" | "chat">("browse");
  const [browseStale, setBrowseStale] = useState(true);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState(false);
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

    browseRecent({
      type: activeType || undefined,
      topic: activeTopic || undefined,
      limit: limit + 1,
    })
      .then((results) => {
        if (id !== requestIdRef.current) return;
        setHasMore(results.length > limit);
        setRecentThoughts(results.slice(0, limit));
        setBrowseStale(false);
      })
      .catch(() => {
        if (id !== requestIdRef.current) return;
        setRecentThoughts([]);
      })
      .finally(() => {
        if (id !== requestIdRef.current) return;
        setBrowseLoading(false);
      });
  }, [activeType, activeTopic, limit, mode, browseStale]);

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

  const handleCapture = async (text: string, scope: Scope) => {
    setCaptureLoading(true);
    setCaptureError(null);
    setCaptureSuccess(false);
    try {
      await captureThought(text, scope);
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

  const handleTypeChange = (type: string | null) => {
    setLimit(20);
    setBrowseStale(true);
    setActiveType(type);
  };

  const handleTopicChange = (topic: string | null) => {
    setLimit(20);
    setBrowseStale(true);
    setActiveTopic(topic);
  };

  const handleTypeClick = (type: string) => {
    setMode("browse");
    setLimit(20);
    setBrowseStale(true);
    setActiveType((prev) => (prev === type ? null : type));
  };

  const handleEditThought = async (id: string, text: string, scope: Scope) => {
    await updateThought(id, text, scope);
    setRecentThoughts((thoughts) =>
      thoughts.map((t) => (t.id === id ? { ...t, content: text } : t))
    );
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
    setActiveType(null);
    setActiveTopic(topic);
  };

  const topTopics = useMemo(
    () =>
      stats
        ? Object.entries(stats.topics)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([t]) => t)
        : [],
    [stats],
  );

  return (
    <div className="pb-32">
      <StatsBar stats={stats} onTypeClick={handleTypeClick} />

      {insight && !insightDismissed && (
        <div className="mt-4">
          <InsightCard
            insight={insight}
            onExplore={handleInsightExplore}
            onDismiss={() => setInsightDismissed(true)}
          />
        </div>
      )}

      {mode === "chat" && messages.length > 0 ? (
        <div className="mt-5 space-y-4">
          <button
            onClick={handleBackToBrowse}
            className="text-sm text-brain-muted/60 hover:text-brain-muted flex items-center gap-1 font-label transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to recent thoughts
          </button>

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-brain-primary text-brain-primary-on"
                    : "bg-brain-surface text-white/80"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      ) : (
        <>
          <div className="mt-5">
            <FilterChips
              activeType={activeType}
              activeTopic={activeTopic}
              topTopics={topTopics}
              onTypeChange={handleTypeChange}
              onTopicChange={handleTopicChange}
            />
          </div>

          <div className="mt-4 space-y-3">
            {!browseLoading && recentThoughts.length === 0 && (
              <p className="text-brain-muted/60 text-center py-8 font-label">
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
              onClick={() => {
                setLimit((l) => l + 20);
                setBrowseStale(true);
              }}
              className="w-full mt-3 py-2 text-sm text-brain-muted hover:text-white bg-brain-surface hover:bg-brain-high rounded-xl font-label transition-colors"
            >
              Load more
            </button>
          )}
        </>
      )}

      {captureSuccess && (
        <div className="fixed bottom-28 left-0 right-0 flex justify-center pointer-events-none z-10">
          <div className="bg-brain-secondary/20 text-brain-secondary px-4 py-2 rounded-xl text-sm shadow-lg font-label neural-glow">
            Thought captured
          </div>
        </div>
      )}
      {captureError && (
        <div className="fixed bottom-28 left-0 right-0 flex justify-center z-10">
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
