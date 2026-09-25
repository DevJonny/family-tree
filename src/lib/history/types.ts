import type { Patch } from "immer";

/** One undoable unit of work: a set of forward/inverse Immer patches. */
export interface HistoryEntry {
  id: string;
  /** Short human label shown in a future "history browser" UI, e.g. "Add individual". */
  label: string;
  timestamp: number;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface HistorySnapshot {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}
