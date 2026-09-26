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
