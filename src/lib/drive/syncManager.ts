import type { DriveFileRef } from "./types";

/**
 * Pure conflict-detection logic, kept separate from the network calls in
 * driveClient.ts so it can be unit tested without mocking fetch/OAuth.
 *
 * A conflict exists when the remote file has been modified by someone/
 * something else (another device, the Drive web UI, ...) since the last
 * time *this* client synced it, AND we also have unsynced local edits.
 * Comparing md5Checksum is preferred (content-based, immune to clock
 * skew); modifiedTime is the fallback for files where Drive hasn't
 * returned a checksum yet.
 */
export function remoteChangedSinceLastSync(
  lastSynced: DriveFileRef | undefined,
  remote: DriveFileRef,
): boolean {
  if (!lastSynced) return false;
  if (lastSynced.fileId !== remote.fileId) return true;
  if (lastSynced.md5Checksum && remote.md5Checksum) {
    return lastSynced.md5Checksum !== remote.md5Checksum;
  }
  return lastSynced.modifiedTime !== remote.modifiedTime;
}

export function hasConflict(
  lastSynced: DriveFileRef | undefined,
  remote: DriveFileRef,
  hasUnsyncedLocalEdits: boolean,
): boolean {
  return hasUnsyncedLocalEdits && remoteChangedSinceLastSync(lastSynced, remote);
}

/**
 * NOT YET WIRED INTO THE UI.
 *
 * This will become the orchestrator that:
 *   1. On connect: ensures the app folder exists, finds or creates the
 *      GEDCOM file, downloads it, and loads it into the FamilyTree store
 *      via `history.reset()` (not undoable — it's a fresh load).
 *   2. On local edits (debounced ~2s): re-checks remote metadata via
 *      getFileMetadata, calls hasConflict(), and either uploads
 *      (updateGedcomFile) or surfaces a SyncConflict for the user to
 *      resolve (keep local / keep remote / manual merge).
 *   3. Persists { fileRef, lastSyncedAt } to idb-keyval so reconnecting
 *      doesn't require re-picking the file.
 *
 * Left as a stub until NEXT_PUBLIC_GOOGLE_CLIENT_ID is configured (see
 * ARCHITECTURE.md) — wiring it up before that would just produce a
 * "Connect to Drive" button that always fails.
 */
export {};
