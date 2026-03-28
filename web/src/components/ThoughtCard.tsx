import { useState } from "react";
import ReactMarkdown from "react-markdown";
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
  onUpdate?: (id: string, text: string, scope: "private" | "shared") => Promise<void>;
  onDelete?: (id: string, scope: "private" | "shared") => Promise<void>;
}

export function ThoughtCard({ thought, onUpdate, onDelete }: ThoughtCardProps) {
  const color = TYPE_COLORS[thought.type] || "#8b949e";
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(thought.content);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = !!(thought.id && onUpdate);
  const canDelete = !!(thought.id && onDelete);

  async function handleSave() {
    if (!thought.id || !onUpdate) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate(thought.id, editText.trim(), thought.scope);
      setEditing(false);
    } catch (e: any) {
      setError(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdit() {
    setEditText(thought.content);
    setEditing(false);
    setError(null);
  }

  async function handleConfirmDelete() {
    if (!thought.id || !onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(thought.id, thought.scope);
    } catch (e: any) {
      setError(e.message ?? "Failed to delete");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

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
          {editing ? (
            <textarea
              className="flex-1 bg-gray-800 text-gray-200 text-sm rounded p-2 resize-none border border-gray-700 focus:outline-none focus:border-blue-500"
              rows={4}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              disabled={saving}
              autoFocus
            />
          ) : (
            <div className="text-gray-200 text-sm flex-1 prose prose-invert prose-sm max-w-none prose-p:my-1 prose-li:my-0">
              <ReactMarkdown>{thought.content}</ReactMarkdown>
            </div>
          )}
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
            {canEdit && !editing && (
              <button
                onClick={() => { setEditing(true); setConfirmDelete(false); setError(null); }}
                className="text-gray-500 hover:text-blue-400 transition-colors"
                title="Edit thought"
                aria-label="Edit thought"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            {canDelete && !editing && (
              <button
                onClick={() => { setConfirmDelete(true); setEditing(false); setError(null); }}
                className="text-gray-500 hover:text-red-400 transition-colors"
                title="Delete thought"
                aria-label="Delete thought"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-xs">{error}</p>
        )}

        {editing && (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !editText.trim()}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleCancelEdit}
              disabled={saving}
              className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {confirmDelete && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Delete this thought?</span>
            <button
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded transition-colors"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {thought.media_url && (
          <div className="rounded overflow-hidden">
            <img
              src={thought.media_url}
              alt=""
              className="max-w-full max-h-64 object-contain rounded"
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          </div>
        )}

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
