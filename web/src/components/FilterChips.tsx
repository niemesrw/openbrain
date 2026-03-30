import { TYPE_COLORS } from "../lib/type-colors";

const ALL_TYPES = ["observation", "task", "idea", "reference", "person_note"];

interface FilterChipsProps {
  activeType: string | null;
  activeTopic: string | null;
  topTopics: string[];
  onTypeChange: (type: string | null) => void;
  onTopicChange: (topic: string | null) => void;
}

export function FilterChips({
  activeType,
  activeTopic,
  topTopics,
  onTypeChange,
  onTopicChange,
}: FilterChipsProps) {
  return (
    <div className="space-y-2 font-label">
      <div className="flex flex-wrap gap-2">
        {ALL_TYPES.map((t) => {
          const active = activeType === t;
          const color = TYPE_COLORS[t];
          return (
            <button
              key={t}
              onClick={() => onTypeChange(active ? null : t)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: active ? color + "25" : "transparent",
                color: color,
                boxShadow: active ? `0 0 12px ${color}30` : "none",
              }}
            >
              {t.replace("_", " ")}
            </button>
          );
        })}
      </div>
      {topTopics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {topTopics.map((topic) => {
            const active = activeTopic === topic;
            return (
              <button
                key={topic}
                onClick={() => onTopicChange(active ? null : topic)}
                className="px-2.5 py-0.5 rounded-full text-xs font-medium transition-all"
                style={{
                  backgroundColor: active ? "rgba(0, 227, 253, 0.15)" : "transparent",
                  color: active ? "#00e3fd" : "#adaaaa",
                }}
              >
                {topic}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
