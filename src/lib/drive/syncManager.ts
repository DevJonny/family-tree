import { saveGedcom } from "../gedcom";
import type { FamilyTree } from "../gedcom/model";
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

/** True when there's nothing open worth keeping: no records of any kind, just a header. */
export function isEmptyTree(tree: FamilyTree): boolean {
  const records = [tree.individuals, tree.families, tree.sources, tree.repositories, tree.notes];
  return records.every((r) => Object.keys(r).length === 0) && tree.otherRoots.length === 0;
}

/**
 * What to do when connecting to a Drive folder that already has a file.
 * Loading it replaces whatever is open, so only do that silently when
 * nothing is open; otherwise ask, unless the two are already the same.
 */
export function planConnect(local: FamilyTree, remoteText: string): "load-remote" | "in-sync" | "ask" {
  if (isEmptyTree(local)) return "load-remote";
  return saveGedcom(local) === remoteText ? "in-sync" : "ask";
}
