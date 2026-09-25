import { applyPatches, enablePatches, produceWithPatches, type Draft } from "immer";
import type { HistoryEntry, HistorySnapshot } from "./types";

enablePatches();

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `h${nextId}`;
}

export type Recipe<T> = (draft: Draft<T>) => void;
export type Listener<T> = (state: T, snapshot: HistorySnapshot) => void;

/**
 * Generic undo/redo engine built on Immer patches.
 *
 * Every mutation is expressed as a "recipe" (an Immer producer function).
 * `apply()` runs it, records the forward and inverse patch sets, and pushes
 * them onto the undo stack. `undo()`/`redo()` replay inverse/forward patches
 * without needing to know anything about the shape of T (individuals,
 * families, GEDCOM nodes, whatever) — this class is deliberately generic so
 * it can be unit tested in isolation from the family-tree domain model.
 *
 * A new `apply()` after an `undo()` clears the redo stack, matching standard
 * editor undo/redo semantics (no redo "branches").
 */
export class History<T> {
  #state: T;
  #undoStack: HistoryEntry[] = [];
  #redoStack: HistoryEntry[] = [];
  #listeners = new Set<Listener<T>>();
  #maxEntries: number;

  constructor(initialState: T, options?: { maxEntries?: number }) {
    this.#state = initialState;
    this.#maxEntries = options?.maxEntries ?? 500;
  }

  get state(): T {
    return this.#state;
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  get snapshot(): HistorySnapshot {
    return { undoStack: [...this.#undoStack], redoStack: [...this.#redoStack] };
  }

  subscribe(listener: Listener<T>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Applies a mutation and records it as a new undo-able entry. */
  apply(recipe: Recipe<T>, label = "Edit"): void {
    const [nextState, patches, inversePatches] = produceWithPatches(this.#state, recipe);
    if (patches.length === 0) {
      // No-op edit (e.g. setting a field to its current value) - don't
      // pollute the undo stack.
      return;
    }
    this.#state = nextState;
    this.#undoStack.push({ id: makeId(), label, timestamp: Date.now(), patches, inversePatches });
    if (this.#undoStack.length > this.#maxEntries) {
      this.#undoStack.shift();
    }
    this.#redoStack = [];
    this.#notify();
  }

  /**
   * Directly replaces the state without recording history. Intended for
   * loading a freshly imported/synced GEDCOM file, where "undo" should not
   * step back into the previous document.
   */
  reset(state: T): void {
    this.#state = state;
    this.#undoStack = [];
    this.#redoStack = [];
    this.#notify();
  }

  undo(): boolean {
    const entry = this.#undoStack.pop();
    if (!entry) return false;
    this.#state = applyPatches(this.#state as object, entry.inversePatches) as T;
    this.#redoStack.push(entry);
    this.#notify();
    return true;
  }

  redo(): boolean {
    const entry = this.#redoStack.pop();
    if (!entry) return false;
    this.#state = applyPatches(this.#state as object, entry.patches) as T;
    this.#undoStack.push(entry);
    this.#notify();
    return true;
  }

  #notify(): void {
    const snap = this.snapshot;
    for (const listener of this.#listeners) listener(this.#state, snap);
  }
}
