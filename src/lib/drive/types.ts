export type SyncStatus =
  | "signed-out"
  | "idle"
  | "syncing"
  | "conflict"
  /** Signed in before, but the token expired or was refused. Local edits are kept until the user signs in again. */
  | "needs-auth"
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
  local: { text: string; savedAt: number };
  remote: { text: string; file: DriveFileRef };
}
