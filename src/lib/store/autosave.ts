import { saveGedcom } from "../gedcom";
import { useFamilyTreeStore } from "./familyTreeStore";

/**
 * Keeps unsaved work in the browser, so closing the tab (or a crash) before
 * an export or Drive sync doesn't lose it. Only unsaved trees are kept: the
 * record is written while the tree is dirty and removed as soon as it's
 * saved again, so a leftover record always means "work that isn't saved
 * anywhere else". The next visit offers to restore it.
 *
 * Stores GEDCOM text, which round-trips losslessly and needs no schema of
 * its own. The key-value store is passed in (IndexedDB in the app, a Map in
 * tests).
 */

export const AUTOSAVE_KEY = "family-tree:autosave";

export interface AutosaveRecord {
  text: string;
  fileName: string | null;
  /** Epoch ms of the last write. */
  savedAt: number;
}

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

function isRecord(value: unknown): value is AutosaveRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.text === "string" &&
    typeof r.savedAt === "number" &&
    (r.fileName === null || typeof r.fileName === "string")
  );
}

export async function readAutosave(kv: KeyValueStore): Promise<AutosaveRecord | null> {
  const value = await kv.get(AUTOSAVE_KEY);
  return isRecord(value) ? value : null;
}

export function clearAutosave(kv: KeyValueStore): Promise<void> {
  return kv.del(AUTOSAVE_KEY);
}

export interface Autosaver {
  /** Writes any pending change now (e.g. when the page is being hidden). */
  flush: () => void;
  /** Stops watching; nothing more is written. */
  stop: () => void;
}

/**
 * Watches the tree store: while it's dirty, writes it (debounced by
 * `delayMs`); once it's saved, deletes the record.
 */
export function startAutosave(
  kv: KeyValueStore,
  { delayMs = 1000, now = Date.now }: { delayMs?: number; now?: () => number } = {},
): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const write = () => {
    timer = null;
    if (stopped) return;
    const { tree, fileName, dirty } = useFamilyTreeStore.getState();
    if (!dirty) return;
    const record: AutosaveRecord = { text: saveGedcom(tree), fileName, savedAt: now() };
    // Best effort: storage can be full or blocked (private windows); the
    // unsaved-changes warning still covers closing the tab.
    kv.set(AUTOSAVE_KEY, record).catch(() => {});
  };

  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (useFamilyTreeStore.getState().dirty) timer = setTimeout(write, delayMs);
    else kv.del(AUTOSAVE_KEY).catch(() => {});
  };

  const unsubscribe = useFamilyTreeStore.subscribe((state, prev) => {
    if (state.tree !== prev.tree || state.dirty !== prev.dirty) onChange();
  });
  if (useFamilyTreeStore.getState().dirty) onChange();

  return {
    flush: () => {
      if (!timer) return;
      clearTimeout(timer);
      write();
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      unsubscribe();
    },
  };
}
