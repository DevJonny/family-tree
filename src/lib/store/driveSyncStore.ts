"use client";

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { useFamilyTreeStore } from "./familyTreeStore";
import { loadGedcom } from "../gedcom";
import {
  createGedcomFile,
  downloadFileContent,
  ensureAppFolder,
  getFileMetadata,
  listGedcomFiles,
  requestAccessToken,
  updateGedcomFile,
} from "../drive/driveClient";
import { hasConflict } from "../drive/syncManager";
import type { DriveFileRef, SyncConflict, SyncStatus } from "../drive/types";

const IDB_KEY = "family-tree:drive-file-ref";
const DEBOUNCE_MS = 2000;
const DEFAULT_FILE_NAME = "family-tree.ged";

interface DriveSyncState {
  status: SyncStatus;
  fileRef: DriveFileRef | null;
  error: string | null;
  conflict: SyncConflict | null;

  connect: () => Promise<void>;
  disconnect: () => void;
  syncNow: () => Promise<void>;
  resolveConflict: (choice: "local" | "remote") => Promise<void>;
}

// Kept outside the store (not React state): the OAuth access token is
// short-lived and re-requested each session, and the debounce timer/tree
// subscription are plumbing, not state a component should render from.
let accessToken: string | null = null;
let lastSyncedText: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeFromTree: (() => void) | null = null;
let lastSeenTree: unknown = null;

export const useDriveSyncStore = create<DriveSyncState>((set, get) => {
  function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void get().syncNow(), DEBOUNCE_MS);
  }

  function watchForLocalEdits() {
    if (unsubscribeFromTree) return;
    lastSeenTree = useFamilyTreeStore.getState().tree;
    unsubscribeFromTree = useFamilyTreeStore.subscribe((state) => {
      if (state.tree !== lastSeenTree) {
        lastSeenTree = state.tree;
        if (get().status !== "signed-out") scheduleSync();
      }
    });
  }

  return {
    status: "signed-out",
    fileRef: null,
    error: null,
    conflict: null,

    connect: async () => {
      set({ status: "syncing", error: null });
      try {
        accessToken = await requestAccessToken({ interactive: true });
        const folderId = await ensureAppFolder(accessToken);

        const cachedRef = await idbGet<DriveFileRef>(IDB_KEY);
        const files = await listGedcomFiles(accessToken, folderId);

        let fileRef: DriveFileRef;
        const rememberedStillExists = cachedRef && files.find((f) => f.fileId === cachedRef.fileId);
        if (rememberedStillExists) {
          fileRef = rememberedStillExists;
        } else if (files.length > 0) {
          // No remembered file (first connect on this device/browser): if
          // the folder already has GEDCOM file(s) - e.g. from another
          // device - use the most recently modified one rather than
          // silently creating a duplicate.
          fileRef = [...files].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0];
        } else {
          const text = useFamilyTreeStore.getState().exportToGedcomText();
          fileRef = await createGedcomFile(accessToken, folderId, DEFAULT_FILE_NAME, text);
        }

        const text = await downloadFileContent(accessToken, fileRef.fileId);
        const { tree, warnings } = loadGedcom(text);
        useFamilyTreeStore.getState().loadTree(tree, fileRef.name, warnings);

        await idbSet(IDB_KEY, fileRef);
        lastSyncedText = text;
        set({ status: "idle", fileRef });
        watchForLocalEdits();
      } catch (err) {
        set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },

    disconnect: () => {
      if (unsubscribeFromTree) {
        unsubscribeFromTree();
        unsubscribeFromTree = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      accessToken = null;
      lastSyncedText = null;
      set({ status: "signed-out", fileRef: null, error: null, conflict: null });
    },

    syncNow: async () => {
      const { fileRef } = get();
      if (!accessToken || !fileRef) return;

      const localText = useFamilyTreeStore.getState().exportToGedcomText();
      if (localText === lastSyncedText) return; // nothing new to push

      set({ status: "syncing", error: null });
      try {
        const remoteMeta = await getFileMetadata(accessToken, fileRef.fileId);
        if (hasConflict(fileRef, remoteMeta, true)) {
          const remoteText = await downloadFileContent(accessToken, fileRef.fileId);
          set({
            status: "conflict",
            conflict: {
              local: { text: localText, savedAt: Date.now() },
              remote: { text: remoteText, file: remoteMeta },
            },
          });
          return;
        }

        const updated = await updateGedcomFile(accessToken, fileRef.fileId, localText);
        await idbSet(IDB_KEY, updated);
        lastSyncedText = localText;
        set({ status: "idle", fileRef: updated });
      } catch (err) {
        set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },

    resolveConflict: async (choice) => {
      const { fileRef, conflict } = get();
      if (!accessToken || !fileRef || !conflict) return;

      set({ status: "syncing", error: null });
      try {
        if (choice === "local") {
          const updated = await updateGedcomFile(accessToken, fileRef.fileId, conflict.local.text);
          await idbSet(IDB_KEY, updated);
          lastSyncedText = conflict.local.text;
          set({ status: "idle", fileRef: updated, conflict: null });
        } else {
          const { tree, warnings } = loadGedcom(conflict.remote.text);
          useFamilyTreeStore.getState().loadTree(tree, undefined, warnings);
          await idbSet(IDB_KEY, conflict.remote.file);
          lastSyncedText = conflict.remote.text;
          set({ status: "idle", fileRef: conflict.remote.file, conflict: null });
        }
      } catch (err) {
        set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
});
