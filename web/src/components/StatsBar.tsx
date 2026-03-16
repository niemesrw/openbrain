import type { BrainStats } from "../lib/brain-types";

const TYPE_COLORS: Record<string, string> = {
  observation: "#58a6ff",
  task: "#f0883e",
  idea: "#a371f7",
  reference: "#8b949e",
  person_note: "#56d364",
};

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
    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-400 bg-gray-900/50 border border-gray-800 rounded-lg px-4 py-2.5">
      <span className="text-gray-200 font-semibold">{stats.total} thoughts</span>
      <span className="text-gray-700">|</span>
      {Object.entries(stats.types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => (
          <button
            key={type}
            onClick={() => onTypeClick(type)}
            className="hover:opacity-80 transition-opacity"
            style={{ color: TYPE_COLORS[type] || "#8b949e" }}
          >
            {count} {type.replace("_", " ")}
          </button>
        ))}
      <span className="text-gray-700">|</span>
      <span>since {since}</span>
    </div>
  );
}
