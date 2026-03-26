import { useState, useEffect, useRef, useMemo } from "react";
import {
  searchThoughts,
  browseRecent,
  getStats,
  captureThought,
  updateThought,
  deleteThought,
} from "../lib/brain-api";
import type { Thought, BrainStats, Message, Scope } from "../lib/brain-types";
import { FilterChips } from "../components/FilterChips";
import { ThoughtCard } from "../components/ThoughtCard";
import { StatsBar } from "../components/StatsBar";
import { BrainInput } from "../components/BrainInput";

function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return true;
  const lower = trimmed.toLowerCase();
  const questionStarts = [
    "what", "when", "where", "who", "why", "how",
    "do i", "did i", "have i", "am i", "is there",
    "can you", "could you", "tell me", "show me",
    "find", "search", "look up", "look for",
  ];
  return questionStarts.some((q) => lower.startsWith(q));
}

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
  const [messages, setMessages] = useState<Message[]>([]);
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

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
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
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      if (isQuestion(text)) {
        const thoughts = await searchThoughts(text, { limit: 10 });
        setMessages((prev) => [
          ...prev,
          makeBrainMessage(
            thoughts.length > 0
              ? `Found ${thoughts.length} thought${thoughts.length === 1 ? "" : "s"}:`
              : "Nothing comes to mind. Want me to remember this instead?",
            thoughts.length > 0 ? thoughts : undefined,
          ),
        ]);
      } else {
        const confirmation = await captureThought(text);
        setMessages((prev) => [...prev, makeBrainMessage(confirmation)]);
        setBrowseStale(true);
        getStats().then(setStats).catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [
        ...prev,
        makeBrainMessage(`Something went wrong: ${msg}`),
      ]);
    } finally {
      setChatLoading(false);
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
    setMode("browse");
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
