"use client";

import { useEffect, useRef, useState } from "react";
import { del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from "idb-keyval";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import {
  autosaveKey,
  clearAutosave,
  readLeftovers,
  startAutosave,
  type Autosaver,
  type KeyValueStore,
  type Leftover,
} from "@/lib/store/autosave";
import { openSessionChecker, thisSessionId } from "@/lib/store/browserSession";
import { loadGedcom } from "@/lib/gedcom";

const idb: KeyValueStore = {
  get: (k) => idbGet(k),
  set: (k, v) => idbSet(k, v),
  del: (k) => idbDel(k),
  keys: () => idbKeys(),
};

const peopleIn = (text: string) => text.match(/^0 @[^@]+@ INDI\b/gm)?.length ?? 0;

/**
 * Guards work that isn't saved anywhere yet (not exported, not on Drive):
 * the browser asks before the tab closes, the tree is autosaved in
 * IndexedDB, and on the next visit a banner offers to restore it.
 *
 * Autosave starts straight away: each session writes its own record, so it
 * can't overwrite a leftover the user hasn't decided about yet.
 */
export function UnsavedWork() {
  const dirty = useFamilyTreeStore((s) => s.dirty);
  const loadTree = useFamilyTreeStore((s) => s.loadTree);
  const [leftovers, setLeftovers] = useState<Leftover[]>([]);
  const autosave = useRef<Autosaver | null>(null);

  useEffect(() => {
    let cancelled = false;
    autosave.current = startAutosave(idb, thisSessionId());
    openSessionChecker()
      .then((isOpen) => readLeftovers(idb, isOpen))
      .catch(() => []) // storage blocked (e.g. some private windows): nothing to restore
      .then((found) => {
        if (!cancelled) setLeftovers(found);
      });
    const flush = () => void autosave.current?.flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      autosave.current?.stop();
      autosave.current = null;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const leftover = leftovers[0];
  if (!leftover) return null;
  const others = leftovers.length - 1;

  const done = () => setLeftovers((current) => current.filter((l) => l.sessionId !== leftover.sessionId));
  const restore = async () => {
    const { tree, warnings } = loadGedcom(leftover.text);
    loadTree(tree, leftover.fileName ?? undefined, warnings, { saved: false });
    done();
    // It's unsaved here now, so this session's own record takes it over.
    // Drop the old one only once that's stored, so there's never a gap.
    await autosave.current?.flush();
    const stored = await idb.get(autosaveKey(thisSessionId())).catch(() => undefined);
    if (stored) await clearAutosave(idb, leftover.sessionId).catch(() => {});
  };
  const discard = () => {
    void clearAutosave(idb, leftover.sessionId).catch(() => {});
    done();
  };

  const when = new Date(leftover.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const people = peopleIn(leftover.text);

  return (
    <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="mb-2">
        <span className="font-medium">You have unsaved work from your last visit</span> ({when}
        {leftover.fileName ? `, ${leftover.fileName}` : ""}, {people} {people === 1 ? "person" : "people"}). It
        wasn&apos;t exported or synced to Drive.
        {others > 0 && ` There ${others === 1 ? "is 1 more" : `are ${others} more`} after this one.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void restore()}
          disabled={dirty}
          className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-50"
        >
          Restore it
        </button>
        <button onClick={discard} className="px-2 py-1 text-xs text-amber-800 hover:underline">
          Discard it
        </button>
        {dirty && (
          <span className="text-xs text-amber-800">
            Restoring would replace your current unsaved changes. Export or undo them first.
          </span>
        )}
      </div>
    </div>
  );
}
