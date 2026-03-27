import { useState, useEffect, useRef, useMemo } from "react";
import {
  browseRecent,
  getStats,
  updateThought,
  deleteThought,
} from "../lib/brain-api";
import { chatWithBrain, getInsight, type ChatMessage, type InsightData } from "../lib/api";
import type { Thought, BrainStats, Message, Scope } from "../lib/brain-types";
import { FilterChips } from "../components/FilterChips";
import { ThoughtCard } from "../components/ThoughtCard";
import { StatsBar } from "../components/StatsBar";
import { BrainInput } from "../components/BrainInput";
import { InsightCard } from "../components/InsightCard";
import { TelegramConnect } from "../components/TelegramConnect";

function makeBrainMessage(text: string, thoughts?: Thought[]): Message {
  return {
    id: crypto.randomUUID(),
    role: "brain",
    text,
    ...(thoughts && { thoughts }),
    timestamp: Date.now(),
  };
}

export function DashboardPage() {
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [recentThoughts, setRecentThoughts] = useState<Thought[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(false);
  const [mode, setMode] = useState<"browse" | "chat">("browse");
  const [browseStale, setBrowseStale] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const chatIdRef = useRef(0);

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

  const handleSubmit = async (text: string) => {
    setMode("chat");
    const chatId = ++chatIdRef.current;
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    const newHistory: ChatMessage[] = [...history, { role: "user", content: text }];
    setHistory(newHistory);

    try {
      const response = await chatWithBrain(newHistory);
      if (chatId !== chatIdRef.current) return;
      setHistory((prev) => [...prev, { role: "assistant", content: response.reply }]);
      setMessages((prev) => [...prev, makeBrainMessage(response.reply)]);
      setBrowseStale(true);
      getStats().then(setStats).catch(() => {});
    } catch (e: unknown) {
      if (chatId !== chatIdRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [
        ...prev,
        makeBrainMessage(`Something went wrong: ${msg}`),
      ]);
    } finally {
      if (chatId === chatIdRef.current) setChatLoading(false);
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
    const updateFn = (thoughts: Thought[]) =>
      thoughts.map((t) => (t.id === id ? { ...t, content: text } : t));
    setRecentThoughts(updateFn);
    setMessages((prev) =>
      prev.map((msg) => (msg.thoughts ? { ...msg, thoughts: updateFn(msg.thoughts) } : msg))
    );
  };

  const handleDeleteThought = async (id: string, scope: Scope) => {
    await deleteThought(id, scope);
    const filterFn = (thoughts: Thought[]) => thoughts.filter((t) => t.id !== id);
    setRecentThoughts(filterFn);
    setMessages((prev) =>
      prev.map((msg) => (msg.thoughts ? { ...msg, thoughts: filterFn(msg.thoughts) } : msg))
    );
  };

  const handleBackToBrowse = () => {
    ++chatIdRef.current;
    setChatLoading(false);
    setMode("browse");
    setMessages([]);
    setHistory([]);
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

      {/* Telegram connect — collapsible */}
      <div className="mt-3">
        <button
          onClick={() => setShowTelegram((v) => !v)}
          aria-expanded={showTelegram}
          aria-controls="telegram-connect-panel"
          className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.868l-2.967-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.985.691z"/>
          </svg>
          Connect Telegram
          <svg className={`w-3 h-3 transition-transform ${showTelegram ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showTelegram && (
          <div id="telegram-connect-panel" className="mt-2">
            <TelegramConnect />
          </div>
        )}
      </div>

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
            className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1"
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
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-200"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>
                {msg.thoughts && (
                  <div className="mt-3 space-y-2">
                    {msg.thoughts.map((t, i) => (
                      <ThoughtCard
                        key={`${t.created_at}-${i}`}
                        thought={t}
                        onUpdate={handleEditThought}
                        onDelete={handleDeleteThought}
                      />
                    ))}
                  </div>
                )}
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
              <p className="text-gray-500 text-center py-8">
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
              className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-800 rounded-lg"
            >
              Load more
            </button>
          )}
        </>
      )}

      <BrainInput onSubmit={handleSubmit} loading={chatLoading} />
    </div>
  );
}
