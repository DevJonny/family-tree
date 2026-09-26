import { saveGedcom } from "../gedcom";
import { useFamilyTreeStore } from "./familyTreeStore";

/**
 * Keeps unsaved work in the browser, so closing the tab (or a crash) before
 * an export or Drive sync doesn't lose it. Only unsaved trees are kept: the
 * record is written while the tree is dirty and removed as soon as it's
 * saved again, so a leftover record always means "work that isn't saved
 * anywhere else". The next visit offers to restore it.
 *
 * Each page load (session) writes its own record, keyed by a session id, so
 * two open tabs can't overwrite or delete each other's work. The caller
 * decides which sessions are still open (the app uses Web Locks), and only
 * records from sessions that aren't are offered as leftovers.
 *
 * Stores GEDCOM text, which round-trips losslessly and needs no schema of
 * its own. The key-value store is passed in (IndexedDB in the app, a Map in
 * tests).
 */

const AUTOSAVE_PREFIX = "family-tree:autosave:";

export const autosaveKey = (sessionId: string) => `${AUTOSAVE_PREFIX}${sessionId}`;

export interface AutosaveRecord {
  text: string;
  fileName: string | null;
  /** Epoch ms of the last write. */
  savedAt: number;
}

export interface Leftover extends AutosaveRecord {
  sessionId: string;
}

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<unknown[]>;
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

/** Records left by sessions that are no longer open, newest first. */
export async function readLeftovers(
  kv: KeyValueStore,
  isOpen: (sessionId: string) => boolean,
): Promise<Leftover[]> {
  const leftovers: Leftover[] = [];
  for (const key of await kv.keys()) {
    if (typeof key !== "string" || !key.startsWith(AUTOSAVE_PREFIX)) continue;
    const sessionId = key.slice(AUTOSAVE_PREFIX.length);
    if (isOpen(sessionId)) continue;
    const value = await kv.get(key);
    if (isRecord(value)) leftovers.push({ ...value, sessionId });
  }
  return leftovers.sort((a, b) => b.savedAt - a.savedAt);
}

export function clearAutosave(kv: KeyValueStore, sessionId: string): Promise<void> {
  return kv.del(autosaveKey(sessionId));
}

export interface Autosaver {
  /** Writes any pending change now (e.g. when the page is being hidden); resolves once it's stored. */
  flush: () => Promise<void>;
  /** Stops watching; nothing more is written. */
  stop: () => void;
}

/**
 * Watches the tree store: while it's dirty, writes it under this session's
 * key (debounced by `delayMs`); once it's saved, deletes that record.
 */
export function startAutosave(
  kv: KeyValueStore,
  sessionId: string,
  { delayMs = 1000, now = Date.now }: { delayMs?: number; now?: () => number } = {},
): Autosaver {
  const key = autosaveKey(sessionId);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const write = (): Promise<void> => {
    timer = null;
    if (stopped) return Promise.resolve();
    const { tree, fileName, dirty } = useFamilyTreeStore.getState();
    if (!dirty) return Promise.resolve();
    const record: AutosaveRecord = { text: saveGedcom(tree), fileName, savedAt: now() };
    // Best effort: storage can be full or blocked (private windows); the
    // unsaved-changes warning still covers closing the tab.
    return kv.set(key, record).catch(() => {});
  };

  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (useFamilyTreeStore.getState().dirty) timer = setTimeout(write, delayMs);
    else kv.del(key).catch(() => {});
  };

  const unsubscribe = useFamilyTreeStore.subscribe((state, prev) => {
    if (state.tree !== prev.tree || state.dirty !== prev.dirty) onChange();
  });
  if (useFamilyTreeStore.getState().dirty) onChange();

  return {
    flush: () => {
      if (!timer) return Promise.resolve();
      clearTimeout(timer);
      return write();
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      unsubscribe();
    },
  };
}
