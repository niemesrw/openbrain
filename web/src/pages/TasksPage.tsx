import { useState, useEffect, useCallback } from "react";
import { listTasks, createTask, cancelTask, type AgentTask } from "../lib/api";

function relTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function TasksPage() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [schedule, setSchedule] = useState("");
  const [action, setAction] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Cancel state
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTasks();
      setTasks(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const s = schedule.trim();
    const a = action.trim();
    if (!t || !s || !a) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createTask(t, s, a);
      setTitle("");
      setSchedule("");
      setAction("");
      setShowForm(false);
      await load();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async (taskId: string) => {
    if (!window.confirm("Cancel this task? It will no longer run.")) return;
    setCancellingId(taskId);
    try {
      await cancelTask(taskId);
      setTasks((prev) => prev.filter((t) => t.taskId !== taskId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-6 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-headline font-semibold text-white">Scheduled Tasks</h1>
          <p className="text-brain-muted text-sm font-label mt-1">
            Automate recurring actions for your agents.
          </p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setCreateError(null); }}
          className="flex items-center gap-2 bg-brain-primary text-brain-primary-on text-sm font-label font-medium px-4 py-2 rounded-lg hover:bg-brain-primary-dim transition-colors"
        >
          <span className="material-symbols-outlined text-base">add</span>
          New Task
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-700/50 space-y-4">
          <h2 className="text-white font-headline font-semibold">New Task</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-brain-muted text-xs font-label uppercase tracking-widest mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Check Hacker News"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-brain-muted/40 focus:outline-none focus:border-brain-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-brain-muted text-xs font-label uppercase tracking-widest mb-1">
                Schedule
              </label>
              <input
                type="text"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder='e.g. "every 6 hours", "daily", "hourly"'
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-brain-muted/40 focus:outline-none focus:border-brain-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-brain-muted text-xs font-label uppercase tracking-widest mb-1">
                Action
              </label>
              <textarea
                value={action}
                onChange={(e) => setAction(e.target.value)}
                rows={3}
                placeholder="Describe what the agent should do…"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-brain-muted/40 focus:outline-none focus:border-brain-primary transition-colors resize-none"
              />
            </div>
            {createError && (
              <p className="text-brain-error text-sm font-label">{createError}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={creating || !title.trim() || !schedule.trim() || !action.trim()}
                className="bg-brain-primary text-brain-primary-on text-sm font-label font-medium px-5 py-2 rounded-lg hover:bg-brain-primary-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? "Scheduling…" : "Schedule Task"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setCreateError(null); }}
                className="text-brain-muted text-sm font-label hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Task list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="material-symbols-outlined animate-spin text-brain-primary text-3xl">
            progress_activity
          </span>
        </div>
      ) : error ? (
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-700/50 text-center">
          <p className="text-brain-error text-sm font-label">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-brain-primary text-sm font-label hover:underline"
          >
            Retry
          </button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl p-10 border border-gray-700/50 text-center space-y-3">
          <span className="material-symbols-outlined text-brain-muted/40 text-5xl">schedule</span>
          <p className="text-brain-muted font-label text-sm">No scheduled tasks yet.</p>
          <button
            onClick={() => setShowForm(true)}
            className="text-brain-primary text-sm font-label hover:underline"
          >
            Create your first task →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.taskId}
              className="bg-gray-900 rounded-2xl p-5 border border-gray-700/50 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-medium text-sm">{task.title}</span>
                  <span className="text-[10px] font-label uppercase tracking-widest text-brain-secondary bg-brain-secondary/10 px-2 py-0.5 rounded-full">
                    {task.schedule}
                  </span>
                </div>
                <p className="text-brain-muted/60 text-xs font-label line-clamp-2">{task.action}</p>
                <p className="text-brain-muted/40 text-xs font-label">
                  Last run: <span className="text-brain-muted/60">{relTime(task.lastRunAt)}</span>
                </p>
              </div>
              <button
                onClick={() => handleCancel(task.taskId)}
                disabled={cancellingId === task.taskId}
                className="text-brain-error hover:text-brain-error/70 text-xs font-label shrink-0 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {cancellingId === task.taskId ? "Cancelling…" : "Cancel"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
