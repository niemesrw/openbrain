import { useState, useEffect, useCallback, useRef } from "react";
import { searchThoughts, browseRecent, getStats } from "../lib/brain-api";
import type { Thought, BrainStats } from "../lib/brain-types";
import { SearchBar } from "../components/SearchBar";
import { FilterChips } from "../components/FilterChips";
import { ThoughtCard } from "../components/ThoughtCard";
import { StatsBar } from "../components/StatsBar";
import { AgentSection } from "../components/AgentSection";

export function DashboardPage() {
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // Load stats once
  useEffect(() => {
    getStats().then((s) => {
      if (mountedRef.current) setStats(s);
    }).catch(() => {});
  }, []);

  // Load thoughts when filters/query change
  const loadThoughts = useCallback(async () => {
    setLoading(true);
    try {
      const filters = {
        type: activeType || undefined,
        topic: activeTopic || undefined,
        limit: limit + 1, // fetch one extra to detect "has more"
      };

      let results: Thought[];
      if (query) {
        results = await searchThoughts(query, filters);
      } else {
        results = await browseRecent(filters);
      }

      if (mountedRef.current) {
        setHasMore(results.length > limit);
        setThoughts(results.slice(0, limit));
      }
    } catch {
      if (mountedRef.current) setThoughts([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [query, activeType, activeTopic, limit]);

  useEffect(() => {
    loadThoughts();
  }, [loadThoughts]);

  const handleSearch = (q: string) => {
    setLimit(20);
    setQuery(q);
  };

  const handleClearSearch = () => {
    setLimit(20);
    setQuery(null);
  };

  const handleTypeChange = (type: string | null) => {
    setLimit(20);
    setActiveType(type);
  };

  const handleTopicChange = (topic: string | null) => {
    setLimit(20);
    setActiveTopic(topic);
  };

  const handleTypeClick = (type: string) => {
    setLimit(20);
    setActiveType((prev) => (prev === type ? null : type));
  };

  const topTopics = stats
    ? Object.entries(stats.topics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([t]) => t)
    : [];

  return (
    <div className="space-y-5">
      <StatsBar stats={stats} onTypeClick={handleTypeClick} />
      <SearchBar onSearch={handleSearch} onClear={handleClearSearch} loading={loading} />
      <FilterChips
        activeType={activeType}
        activeTopic={activeTopic}
        topTopics={topTopics}
        onTypeChange={handleTypeChange}
        onTopicChange={handleTopicChange}
      />

      <div className="space-y-3">
        {!loading && thoughts.length === 0 && (
          <p className="text-gray-500 text-center py-8">
            {query ? "No matching thoughts found." : "No thoughts yet."}
          </p>
        )}
        {thoughts.map((t, i) => (
          <ThoughtCard key={`${t.created_at}-${i}`} thought={t} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setLimit((l) => l + 20)}
          className="w-full py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-800 rounded-lg"
        >
          Load more
        </button>
      )}

      <AgentSection />
    </div>
  );
}
