const TYPE_COLORS: Record<string, string> = {
  observation: "#58a6ff",
  task: "#f0883e",
  idea: "#a371f7",
  reference: "#8b949e",
  person_note: "#56d364",
};

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
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ALL_TYPES.map((t) => {
          const active = activeType === t;
          const color = TYPE_COLORS[t];
          return (
            <button
              key={t}
              onClick={() => onTypeChange(active ? null : t)}
              className="px-3 py-1 rounded-full text-sm font-medium transition-colors"
              style={{
                backgroundColor: active ? color : "transparent",
                color: active ? "#0d1117" : color,
                border: `1px solid ${color}`,
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
                className="px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors"
                style={{
                  backgroundColor: active ? "#30363d" : "transparent",
                  color: active ? "#e6edf3" : "#8b949e",
                  border: `1px solid ${active ? "#484f58" : "#30363d"}`,
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
