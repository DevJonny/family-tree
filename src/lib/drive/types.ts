export type SyncStatus =
  | "signed-out"
  | "idle"
  | "syncing"
  | "conflict"
  /** Signed in before, but the token expired or was refused. Local edits are kept until the user signs in again. */
  | "needs-auth"
  /** Connecting: the Drive folder has several files and none is remembered, so the user picks one. */
  | "choosing-file"
  | "error";

/** Metadata about the GEDCOM file this app owns on the user's Drive. */
export interface DriveFileRef {
  fileId: string;
  name: string;
  /** Drive's modifiedTime (RFC3339) at the point we last read/wrote it. */
  modifiedTime: string;
  /** Drive's md5Checksum at the point we last read/wrote it, used for conflict detection. */
  md5Checksum?: string;
}

export interface SyncConflict {
  /**
   * "connect": Drive already had a file that differs from the tree open
   * here. "remote-changed": the file changed on Drive since our last sync.
   */
  reason: "connect" | "remote-changed";
  remote: { text: string; file: DriveFileRef };
}
