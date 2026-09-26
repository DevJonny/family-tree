"use client";

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { useFamilyTreeStore } from "./familyTreeStore";
import { loadGedcom, saveGedcom } from "../gedcom";
import * as driveClient from "../drive/driveClient";
import { DriveAuthError } from "../drive/driveClient";
import { chooseFile, hasConflict, planConnect } from "../drive/syncManager";
import { serialized } from "../drive/serialized";
import { usableToken, type AccessToken } from "../drive/token";
import type { DriveFileRef, SyncConflict, SyncStatus } from "../drive/types";

const FILE_REF_KEY = "family-tree:drive-file-ref";
const DEFAULT_FILE_NAME = "family-tree.ged";

interface DriveSyncState {
  status: SyncStatus;
  fileRef: DriveFileRef | null;
  error: string | null;
  conflict: SyncConflict | null;
  /** While `status` is "choosing-file": the folder's files, newest first. */
  fileChoices: DriveFileRef[] | null;

  connect: () => Promise<void>;
  /** Connects to one of `fileChoices` (from a click: it may need to sign in again). */
  pickFile: (fileId: string) => Promise<void>;
  /**
   * Picks sync back up after an expired sign-in or an error: gets a fresh
   * token if needed (opens Google's popup, so call from a click), then
   * pushes local edits. Unlike `connect`, it never reloads from Drive, so
   * edits made while signed out aren't lost.
   */
  resume: () => Promise<void>;
  /** Stops syncing. Also how the "which file?" picker and a connect conflict are cancelled. */
  disconnect: () => void;
  syncNow: () => Promise<void>;
  resolveConflict: (choice: "local" | "remote") => Promise<void>;
}

/** The Drive calls the store makes; `driveClient` in the app, an in-memory Drive in tests. */
export interface DriveApi {
  requestAccessToken: () => Promise<AccessToken>;
  ensureAppFolder: (token: string) => Promise<string>;
  listGedcomFiles: (token: string, folderId: string) => Promise<DriveFileRef[]>;
  downloadFileContent: (token: string, fileId: string) => Promise<string>;
  createGedcomFile: (token: string, folderId: string, name: string, content: string) => Promise<DriveFileRef>;
  updateGedcomFile: (token: string, fileId: string, content: string) => Promise<DriveFileRef>;
  getFileMetadata: (token: string, fileId: string) => Promise<DriveFileRef>;
}

export interface DriveSyncDeps {
  drive: DriveApi;
  /** Where the connected file's ref is remembered between visits (IndexedDB in the app). */
  kv: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> };
  now?: () => number;
  /** How long edits settle before they're uploaded. */
  debounceMs?: number;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The Drive sync state machine, over injected Drive calls and storage so
 * it can be tested against an in-memory Drive (see
 * __tests__/driveSyncStore.test.ts). The app uses `useDriveSyncStore`.
 */
export function createDriveSyncStore({ drive, kv, now = Date.now, debounceMs = 2000 }: DriveSyncDeps) {
  // Kept outside the store state (not rendered from): the OAuth access token
  // is short-lived and re-requested each session, and the debounce timer and
  // tree subscription are plumbing.
  let token: AccessToken | null = null;
  let lastSyncedText: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeFromTree: (() => void) | null = null;
  let lastSeenTree: unknown = null;

  return create<DriveSyncState>((set, get) => {
    /** The current token if it's still safe to use; otherwise stops for sign-in, keeping local edits. */
    function tokenOrStop(): string | null {
      const value = usableToken(token, now());
      if (!value) set({ status: "needs-auth", error: null });
      return value;
    }

    /** A usable token, signing in again if needed. Only from a click: it may open Google's popup. */
    async function freshToken(): Promise<string> {
      const value = usableToken(token, now());
      if (value) return value;
      token = await drive.requestAccessToken();
      return token.value;
    }

    function fail(err: unknown) {
      if (err instanceof DriveAuthError) {
        token = null;
        set({ status: get().fileRef ? "needs-auth" : "signed-out", error: message(err), fileChoices: null });
      } else {
        set({ status: "error", error: message(err), fileChoices: null });
      }
    }

    /** False once `disconnect` (or a switch to another file) happened while a call was awaiting Drive. */
    function stillConnectedTo(fileRef: DriveFileRef): boolean {
      return get().fileRef?.fileId === fileRef.fileId;
    }

    function scheduleSync() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void get().syncNow(), debounceMs);
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

    /** Downloads the chosen file and starts syncing it, asking first if that would replace a different open tree. */
    async function openFile(accessToken: string, fileRef: DriveFileRef) {
      const localTree = useFamilyTreeStore.getState().tree;
      const text = await drive.downloadFileContent(accessToken, fileRef.fileId);
      if (get().status !== "syncing") return; // disconnected meanwhile
      await kv.set(FILE_REF_KEY, fileRef);
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
        set({ status: "conflict", fileRef, conflict: { reason: "connect", remote: { text, file: fileRef } } });
      } else {
        set({ status: "idle", fileRef });
      }
      watchForLocalEdits();
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
        const remoteMeta = await drive.getFileMetadata(accessToken, fileRef.fileId);
        if (!stillConnectedTo(fileRef)) return;
        if (hasConflict(fileRef, remoteMeta, true)) {
          const remoteText = await drive.downloadFileContent(accessToken, fileRef.fileId);
          if (!stillConnectedTo(fileRef)) return;
          set({
            status: "conflict",
            conflict: { reason: "remote-changed", remote: { text: remoteText, file: remoteMeta } },
          });
          return;
        }

        const updated = await drive.updateGedcomFile(accessToken, fileRef.fileId, localText);
        // Disconnected mid-upload: leave the tree dirty rather than resurrect the connection.
        if (!stillConnectedTo(fileRef)) return;
        await kv.set(FILE_REF_KEY, updated);
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
      fileChoices: null,

      connect: async () => {
        set({ status: "syncing", error: null, fileChoices: null });
        try {
          token = await drive.requestAccessToken();
          const accessToken = token.value;
          const folderId = await drive.ensureAppFolder(accessToken);
          const remembered = (await kv.get(FILE_REF_KEY)) as DriveFileRef | undefined;
          const files = await drive.listGedcomFiles(accessToken, folderId);
          if (get().status !== "syncing") return; // disconnected meanwhile

          const choice = chooseFile(files, remembered?.fileId);
          if (choice.kind === "ask") {
            set({ status: "choosing-file", fileChoices: choice.files });
            return;
          }
          const fileRef =
            choice.kind === "use"
              ? choice.file
              : await drive.createGedcomFile(
                  accessToken,
                  folderId,
                  DEFAULT_FILE_NAME,
                  useFamilyTreeStore.getState().exportToGedcomText(),
                );
          await openFile(accessToken, fileRef);
        } catch (err) {
          fail(err);
        }
      },

      pickFile: async (fileId) => {
        const file = get().fileChoices?.find((f) => f.fileId === fileId);
        if (get().status !== "choosing-file" || !file) return;
        set({ status: "syncing", error: null, fileChoices: null });
        try {
          await openFile(await freshToken(), file);
        } catch (err) {
          fail(err);
        }
      },

      resume: async () => {
        if (!get().fileRef) return get().connect();
        if (!usableToken(token, now())) {
          set({ status: "syncing", error: null });
          try {
            await freshToken();
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
        set({ status: "signed-out", fileRef: null, error: null, conflict: null, fileChoices: null });
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
            await kv.set(FILE_REF_KEY, conflict.remote.file);
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
          const updated = await drive.updateGedcomFile(accessToken, fileRef.fileId, localText);
          if (!stillConnectedTo(fileRef)) return;
          await kv.set(FILE_REF_KEY, updated);
          lastSyncedText = localText;
          useFamilyTreeStore.getState().markSaved(tree);
          set({ status: "idle", fileRef: updated, conflict: null });
        } catch (err) {
          fail(err);
        }
      },
    };
  });
}

export const useDriveSyncStore = createDriveSyncStore({
  drive: driveClient,
  kv: { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v) },
});
