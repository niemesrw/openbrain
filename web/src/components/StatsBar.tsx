import type { BrainStats } from "../lib/brain-types";
import { TYPE_COLORS } from "../lib/type-colors";

interface StatsBarProps {
  stats: BrainStats | null;
  onTypeClick: (type: string) => void;
}

export function StatsBar({ stats, onTypeClick }: StatsBarProps) {
  if (!stats) return null;

  const since = stats.earliest
    ? new Date(stats.earliest).toLocaleDateString()
    : "N/A";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-brain-muted bg-brain-surface rounded-xl px-4 py-2.5 font-label">
      <span className="text-white font-semibold">{stats.total} thoughts</span>
      <span className="text-brain-outline">·</span>
      {Object.entries(stats.types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => (
          <button
            key={type}
            onClick={() => onTypeClick(type)}
            className="hover:opacity-80 transition-opacity"
            style={{ color: TYPE_COLORS[type] || "#adaaaa" }}
          >
            {count} {type.replace("_", " ")}
          </button>
        ))}
      <span className="text-brain-outline">·</span>
      <span>since {since}</span>
    </div>
  );
}
