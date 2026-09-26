"use client";

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { useFamilyTreeStore } from "./familyTreeStore";
import { loadGedcom, saveGedcom } from "../gedcom";
import {
  DriveAuthError,
  createGedcomFile,
  downloadFileContent,
  ensureAppFolder,
  getFileMetadata,
  listGedcomFiles,
  requestAccessToken,
  updateGedcomFile,
} from "../drive/driveClient";
import { hasConflict, planConnect } from "../drive/syncManager";
import { serialized } from "../drive/serialized";
import { usableToken, type AccessToken } from "../drive/token";
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
  /**
   * Picks sync back up after an expired sign-in or an error: gets a fresh
   * token if needed (opens Google's popup, so call from a click), then
   * pushes local edits. Unlike `connect`, it never reloads from Drive, so
   * edits made while signed out aren't lost.
   */
  resume: () => Promise<void>;
  disconnect: () => void;
  syncNow: () => Promise<void>;
  resolveConflict: (choice: "local" | "remote") => Promise<void>;
}

// Kept outside the store (not React state): the OAuth access token is
// short-lived and re-requested each session, and the debounce timer/tree
// subscription are plumbing, not state a component should render from.
let token: AccessToken | null = null;
let lastSyncedText: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeFromTree: (() => void) | null = null;
let lastSeenTree: unknown = null;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useDriveSyncStore = create<DriveSyncState>((set, get) => {
  /** The current token if it's still safe to use; otherwise stops for sign-in, keeping local edits. */
  function tokenOrStop(): string | null {
    const value = usableToken(token, Date.now());
    if (!value) set({ status: "needs-auth", error: null });
    return value;
  }

  function fail(err: unknown) {
    if (err instanceof DriveAuthError) {
      token = null;
      set({ status: get().fileRef ? "needs-auth" : "signed-out", error: message(err) });
    } else {
      set({ status: "error", error: message(err) });
    }
  }

  /** False once `disconnect` (or a switch to another file) happened while a call was awaiting Drive. */
  function stillConnectedTo(fileRef: DriveFileRef): boolean {
    return get().fileRef?.fileId === fileRef.fileId;
  }

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

  // One upload at a time: an overlapping run would read the metadata of
  // this tab's own in-flight write and report it as a conflict.
  const runSync = serialized(async () => {
    const { fileRef, conflict } = get();
    // Nothing goes up while the user is choosing which version to keep.
    if (!fileRef || conflict) return;

    const tree = useFamilyTreeStore.getState().tree;
    const localText = saveGedcom(tree);
    if (localText === lastSyncedText) {
      useFamilyTreeStore.getState().markSaved(tree); // e.g. edited back to what Drive has
      return;
    }

    const accessToken = tokenOrStop();
    if (!accessToken) return;
    set({ status: "syncing", error: null });
    try {
      const remoteMeta = await getFileMetadata(accessToken, fileRef.fileId);
      if (!stillConnectedTo(fileRef)) return;
      if (hasConflict(fileRef, remoteMeta, true)) {
        const remoteText = await downloadFileContent(accessToken, fileRef.fileId);
        if (!stillConnectedTo(fileRef)) return;
        set({
          status: "conflict",
          conflict: {
            reason: "remote-changed",
            remote: { text: remoteText, file: remoteMeta },
          },
        });
        return;
      }

      const updated = await updateGedcomFile(accessToken, fileRef.fileId, localText);
      // Disconnected mid-upload: leave the tree dirty rather than resurrect the connection.
      if (!stillConnectedTo(fileRef)) return;
      await idbSet(IDB_KEY, updated);
      lastSyncedText = localText;
      // The tree that went up, not the current one: edits made during the upload are still unsaved.
      useFamilyTreeStore.getState().markSaved(tree);
      set({ status: "idle", fileRef: updated });
    } catch (err) {
      fail(err);
    }
  });

  return {
    status: "signed-out",
    fileRef: null,
    error: null,
    conflict: null,

    connect: async () => {
      set({ status: "syncing", error: null });
      try {
        token = await requestAccessToken();
        const accessToken = token.value;
        const folderId = await ensureAppFolder(accessToken);

        const cachedRef = await idbGet<DriveFileRef>(IDB_KEY);
        const files = await listGedcomFiles(accessToken, folderId);

        const localTree = useFamilyTreeStore.getState().tree;
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
        await idbSet(IDB_KEY, fileRef);
        lastSyncedText = text;

        // Loading Drive's file replaces the tree open here, so only do it
        // unasked when nothing is open (see planConnect).
        const plan = planConnect(localTree, text);
        if (plan === "load-remote") {
          const { tree, warnings } = loadGedcom(text);
          useFamilyTreeStore.getState().loadTree(tree, fileRef.name, warnings);
        }
        if (plan === "in-sync") useFamilyTreeStore.getState().markSaved(localTree);
        if (plan === "ask") {
          set({
            status: "conflict",
            fileRef,
            conflict: {
              reason: "connect",
              remote: { text, file: fileRef },
            },
          });
        } else {
          set({ status: "idle", fileRef });
        }
        watchForLocalEdits();
      } catch (err) {
        fail(err);
      }
    },

    resume: async () => {
      if (!get().fileRef) return get().connect();
      if (!usableToken(token, Date.now())) {
        set({ status: "syncing", error: null });
        try {
          token = await requestAccessToken();
        } catch (err) {
          fail(err);
          return;
        }
      }
      if (get().conflict) {
        set({ status: "conflict", error: null });
        return;
      }
      set({ status: "idle", error: null });
      await get().syncNow();
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
      token = null;
      lastSyncedText = null;
      set({ status: "signed-out", fileRef: null, error: null, conflict: null });
    },

    syncNow: () => runSync(),

    resolveConflict: async (choice) => {
      const { fileRef, conflict } = get();
      if (!fileRef || !conflict) return;

      if (choice === "remote") {
        // A local load; no Drive call, so no sign-in needed.
        try {
          const { tree, warnings } = loadGedcom(conflict.remote.text);
          useFamilyTreeStore.getState().loadTree(tree, conflict.remote.file.name, warnings);
          await idbSet(IDB_KEY, conflict.remote.file);
          lastSyncedText = conflict.remote.text;
          set({ status: "idle", fileRef: conflict.remote.file, conflict: null, error: null });
        } catch (err) {
          fail(err);
        }
        return;
      }

      const accessToken = tokenOrStop();
      if (!accessToken) return;
      set({ status: "syncing", error: null });
      try {
        // The tree as it is now, not the snapshot from when the banner
        // appeared: edits made while it was showing must go up too.
        const tree = useFamilyTreeStore.getState().tree;
        const localText = saveGedcom(tree);
        const updated = await updateGedcomFile(accessToken, fileRef.fileId, localText);
        await idbSet(IDB_KEY, updated);
        lastSyncedText = localText;
        useFamilyTreeStore.getState().markSaved(tree);
        set({ status: "idle", fileRef: updated, conflict: null });
      } catch (err) {
        fail(err);
      }
    },
  };
});
