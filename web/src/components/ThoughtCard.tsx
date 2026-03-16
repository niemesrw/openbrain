import type { Thought } from "../lib/brain-types";

const TYPE_COLORS: Record<string, string> = {
  observation: "#58a6ff",
  task: "#f0883e",
  idea: "#a371f7",
  reference: "#8b949e",
  person_note: "#56d364",
};

function relativeTime(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

interface ThoughtCardProps {
  thought: Thought;
}

export function ThoughtCard({ thought }: ThoughtCardProps) {
  const color = TYPE_COLORS[thought.type] || "#8b949e";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {thought.similarity != null && (
        <div
          className="h-1"
          style={{
            width: `${thought.similarity}%`,
            backgroundColor: color,
          }}
        />
      )}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-gray-200 text-sm whitespace-pre-wrap flex-1">
            {thought.content}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {thought.scope === "private" ? (
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" role="img" aria-label="Private">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" role="img" aria-label="Shared">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className="px-2 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: color + "20", color }}
          >
            {thought.type.replace("_", " ")}
          </span>
          {thought.topics.map((t) => (
            <span key={t} className="px-2 py-0.5 rounded bg-gray-800 text-gray-400">
              {t}
            </span>
          ))}
          {thought.people.map((p) => (
            <span key={p} className="text-blue-400">@{p}</span>
          ))}
          {thought.similarity != null && (
            <span className="text-gray-600">{thought.similarity}% match</span>
          )}
          <span className="text-gray-600 ml-auto">
            {relativeTime(thought.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
