/**
 * One undoable unit of work: the state before and after it. Immer shares
 * structure between them, so keeping both is cheap, and restoring the exact
 * previous object keeps record order (which is export order) intact. Replaying
 * inverse patches didn't: a deleted key came back at the end of its map.
 */
export interface HistoryEntry<T = unknown> {
  id: string;
  /** Short human label shown in a future "history browser" UI, e.g. "Add individual". */
  label: string;
  timestamp: number;
  before: T;
  after: T;
}

export interface HistorySnapshot {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}
