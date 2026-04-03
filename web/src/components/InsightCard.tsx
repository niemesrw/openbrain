import type { InsightData } from "../lib/api";

interface InsightCardProps {
  insight: InsightData;
  onExplore: (topic: string) => void;
  onDismiss: () => void;
}

export function InsightCard({ insight, onExplore, onDismiss }: InsightCardProps) {
  return (
    <div className="relative rounded-xl bg-brain-surface neural-glow-primary px-4 py-3 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-lg leading-none mt-0.5 shrink-0">🧠</span>
          <div className="min-w-0">
            <p className="text-xs text-brain-primary font-label font-medium uppercase tracking-wide mb-1">
              Your brain noticed something
            </p>
            <p className="text-sm text-white font-medium leading-snug">
              {insight.headline}
            </p>
            {insight.body && (
              <p className="text-sm text-brain-muted mt-1 leading-snug">
                {insight.body}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => onExplore(insight.topic)}
                className="text-xs text-brain-primary hover:text-white font-label font-medium transition-colors"
              >
                Explore {insight.count} thoughts →
              </button>
              <span className="text-xs text-brain-muted/40 font-label">
                #{insight.topic}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-brain-muted/40 hover:text-brain-muted transition-colors shrink-0 mt-0.5"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
