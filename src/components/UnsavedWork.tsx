"use client";

import { useEffect, useRef, useState } from "react";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import {
  clearAutosave,
  readAutosave,
  startAutosave,
  type AutosaveRecord,
  type Autosaver,
  type KeyValueStore,
} from "@/lib/store/autosave";
import { loadGedcom } from "@/lib/gedcom";

const idb: KeyValueStore = { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v), del: (k) => idbDel(k) };

const peopleIn = (text: string) => text.match(/^0 @[^@]+@ INDI\b/gm)?.length ?? 0;

/**
 * Guards work that isn't saved anywhere yet (not exported, not on Drive):
 * the browser asks before the tab closes, the tree is autosaved in
 * IndexedDB, and on the next visit a banner offers to restore it.
 *
 * Autosave only starts once any leftover record has been restored or
 * discarded, so a new session can't overwrite it before the user decides.
 */
export function UnsavedWork() {
  const dirty = useFamilyTreeStore((s) => s.dirty);
  const loadTree = useFamilyTreeStore((s) => s.loadTree);
  const [leftover, setLeftover] = useState<AutosaveRecord | null>(null);
  const autosave = useRef<Autosaver | null>(null);

  const start = () => {
    autosave.current ??= startAutosave(idb);
  };

  useEffect(() => {
    let cancelled = false;
    readAutosave(idb)
      .catch(() => null) // storage blocked (e.g. some private windows): nothing to restore
      .then((record) => {
        if (cancelled) return;
        if (record) setLeftover(record);
        else start();
      });
    const flush = () => autosave.current?.flush();
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

  if (!leftover) return null;

  const restore = () => {
    const { tree, warnings } = loadGedcom(leftover.text);
    loadTree(tree, leftover.fileName ?? undefined, warnings, { saved: false });
    setLeftover(null);
    start(); // the restored tree is unsaved, so this writes it straight back
  };
  const discard = () => {
    void clearAutosave(idb).catch(() => {});
    setLeftover(null);
    start();
  };

  const when = new Date(leftover.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const people = peopleIn(leftover.text);

  return (
    <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="mb-2">
        <span className="font-medium">You have unsaved work from your last visit</span> ({when}
        {leftover.fileName ? `, ${leftover.fileName}` : ""}, {people} {people === 1 ? "person" : "people"}). It
        wasn&apos;t exported or synced to Drive.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={restore}
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
