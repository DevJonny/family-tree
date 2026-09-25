"use client";

import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import type { HistoryEntry } from "@/lib/history/types";

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Displays the full edit history in chronological order (oldest at top),
 * with a "current" marker at the boundary between applied edits
 * (undoStack) and edits available to redo (redoStack).
 *
 * `undoStack` is already stored oldest-first (apply() pushes to the end),
 * so its last entry is the current state. `redoStack` is stored in the
 * order entries were *undone* (most-recently-undone first) so that
 * redo()'s pop() replays the earliest-undone entry first, forward in time
 * — for display we reverse it back into chronological "what happens next
 * if you keep redoing" order.
 */
export function HistoryPanel() {
  const history = useFamilyTreeStore((s) => s.history);
  const undoTo = useFamilyTreeStore((s) => s.undoTo);
  const redoTo = useFamilyTreeStore((s) => s.redoTo);

  const { undoStack, redoStack } = history;
  const pendingRedo = [...redoStack].reverse();

  if (undoStack.length === 0 && redoStack.length === 0) {
    return <p className="p-4 text-center text-xs text-neutral-400">No edits yet.</p>;
  }

  return (
    <div className="max-h-80 overflow-y-auto text-sm">
      {undoStack.map((entry: HistoryEntry, i) => {
        const isCurrent = i === undoStack.length - 1;
        return (
          <button
            key={entry.id}
            onClick={() => undoTo(entry.id)}
            disabled={isCurrent}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-50 disabled:cursor-default disabled:hover:bg-transparent"
            title={isCurrent ? undefined : "Jump back to right after this edit"}
          >
            <span className={`truncate ${isCurrent ? "font-medium" : ""}`}>{entry.label}</span>
            <span className="shrink-0 text-xs text-neutral-400">{timeAgo(entry.timestamp)}</span>
          </button>
        );
      })}
      <div className="border-y border-neutral-900/10 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500">
        ● current
      </div>
      {pendingRedo.map((entry: HistoryEntry) => (
        <button
          key={entry.id}
          onClick={() => redoTo(entry.id)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-neutral-400 hover:bg-neutral-50"
          title="Redo forward to this edit"
        >
          <span className="truncate">{entry.label}</span>
          <span className="shrink-0 text-xs">{timeAgo(entry.timestamp)}</span>
        </button>
      ))}
    </div>
  );
}
